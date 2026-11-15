import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { hasLevel, Refusal, requireHost } from "./access.js";
import { incus } from "./commands.js";
import { InstanceLists, ListError } from "./list.js";
import { ACTIONS, performAction, type Action } from "./operations.js";
import { Processes, ProcessError } from "./process-service.js";
import type { InstanceRow } from "./instances.js";
import { readLogs } from "./logs.js";
import {
  INSTANCE_NAME,
  PROJECT_NAME,
  levelAllows,
  readHostSettings,
  type IncusHostSettings,
} from "./settings.js";

async function answer(
  res: Response,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    res.json(await work());
  } catch (error) {
    if (error instanceof Refusal) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}

export function registerRoutes(
  router: Router,
  ctx: PluginContext,
  lists: InstanceLists,
): void {
  router.use(async (_req, res, next) => {
    if (await hasLevel((p) => ctx.rbac.has(p), "read")) return next();
    res.status(403).json({ error: "You don't have permission for this" });
  });
  const processes = new Processes(ctx);

  // checks, then finds the instance in the host's current list
  async function findInstance(
    req: Request,
  ): Promise<
    | { hostId: number; settings: IncusHostSettings; instance: InstanceRow }
    | { ok: false; reason: "failed"; error: string }
  > {
    const project = String(req.params.project);
    const name = String(req.params.name);
    if (!PROJECT_NAME.test(project) || !INSTANCE_NAME.test(name)) {
      throw new Refusal(400, "Not an instance name");
    }
    const { hostId, settings } = await requireHost(
      ctx,
      req.params.hostId,
      "read",
    );
    let instance: InstanceRow | undefined;
    try {
      instance = (await lists.get(hostId, settings)).find(
        (i) => i.project === project && i.name === name,
      );
    } catch (error) {
      if (error instanceof ListError) {
        return { ok: false, reason: "failed", error: error.message };
      }
      throw error;
    }
    if (!instance) throw new Refusal(404, "Instance not found");
    return { hostId, settings, instance };
  }

  /**
   * @openapi
   * /plugin-api/incus/hosts:
   *   get:
   *     summary: The hosts the signed-in user can see that have Incus turned on
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: Each host's id, name and level
   *       403:
   *         description: No permission to read Incus
   */
  router.get("/hosts", async (_req: Request, res: Response) => {
    await answer(res, async () => {
      const hosts = await ctx.hosts.list();
      const rows = [];
      for (const host of hosts) {
        const settings = await readHostSettings(ctx, host.id);
        if (!settings.enabled) continue;
        rows.push({
          id: host.id,
          name: host.name || `${host.username}@${host.ip}`,
          level: settings.level,
        });
      }
      return { hosts: rows };
    });
  });

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/version:
   *   get:
   *     summary: Which Incus a host runs, to check the plugin can reach it
   *     tags:
   *       - Incus
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The client and server versions, or why incus didn't answer
   *       400:
   *         description: Not a host id
   *       403:
   *         description: No permission, or Incus is off for the host
   *       404:
   *         description: No such host for this user
   */
  router.get("/hosts/:hostId/version", async (req: Request, res: Response) => {
    await answer(res, async () => {
      const { hostId, settings } = await requireHost(
        ctx,
        req.params.hostId,
        "read",
      );
      const result = await ctx.ssh.exec(
        hostId,
        incus(settings.incusCommand, ["version"]),
        {
          purpose: "incus",
          stdin: "",
          timeoutMs: 15_000,
          maxOutputBytes: 4096,
        },
      );
      if (result.code !== 0) {
        return {
          ok: false,
          error: (result.stderr || result.stdout).trim().slice(0, 500),
        };
      }
      return { ok: true, ...parseVersion(result.stdout) };
    });
  });

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances:
   *   get:
   *     summary: A host's Incus instances with their state and usage, secret values left out
   *     tags:
   *       - Incus
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The instances, or why incus didn't answer
   *       400:
   *         description: Not a host id
   *       403:
   *         description: No permission, or Incus is off for the host
   *       404:
   *         description: No such host for this user
   */
  router.get(
    "/hosts/:hostId/instances",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const { hostId, settings } = await requireHost(
          ctx,
          req.params.hostId,
          "read",
        );
        try {
          const instances = await lists.get(hostId, settings);
          return {
            ok: true,
            instances,
            level: settings.level,
            protected: settings.protected,
            operate:
              levelAllows(settings.level, "operate") &&
              (await hasLevel((p) => ctx.rbac.has(p), "operate")) &&
              (await ctx.hosts.checkAccess(hostId, "edit")).hasAccess,
            shell:
              settings.allowShell &&
              (await ctx.rbac.has("shell")) &&
              (await ctx.hosts.checkAccess(hostId, "edit")).hasAccess,
            pollSeconds: settings.pollSeconds,
          };
        } catch (error) {
          if (error instanceof ListError)
            return { ok: false, error: error.message };
          throw error;
        }
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/processes:
   *   get:
   *     summary: An instance's processes with CPU, memory and command line, secret looking arguments blanked
   *     tags:
   *       - Incus
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: project
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The processes, or why they couldn't be read
   *       400:
   *         description: Not a host id or an instance name
   *       403:
   *         description: No permission, or Incus is off for the host
   *       404:
   *         description: No such host or instance
   */
  router.get(
    "/hosts/:hostId/instances/:project/:name/processes",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const found = await findInstance(req);
        if ("ok" in found) return found;
        try {
          return {
            ok: true,
            ...(await processes.list(
              found.hostId,
              found.settings,
              found.instance,
            )),
          };
        } catch (error) {
          if (error instanceof ProcessError) {
            return { ok: false, reason: error.reason, error: error.message };
          }
          throw error;
        }
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/logs:
   *   get:
   *     summary: An instance's recent logs, from its journal or the console output Incus keeps
   *     tags:
   *       - Incus
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: project
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The log text and where it came from, or why it couldn't be read
   *       400:
   *         description: Not a host id or an instance name
   *       403:
   *         description: No permission, or Incus is off for the host
   *       404:
   *         description: No such host or instance
   */
  router.get(
    "/hosts/:hostId/instances/:project/:name/logs",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const found = await findInstance(req);
        if ("ok" in found) return found;
        return readLogs(ctx, found.hostId, found.settings, found.instance);
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/details:
   *   get:
   *     summary: An instance's config, devices and snapshots, with secret looking values hidden
   *     tags:
   *       - Incus
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: project
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The details from the latest list
   *       400:
   *         description: Not a host id or an instance name
   *       403:
   *         description: No permission, or Incus is off for the host
   *       404:
   *         description: No such host or instance
   */
  router.get(
    "/hosts/:hostId/instances/:project/:name/details",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const found = await findInstance(req);
        if ("ok" in found) return found;
        const details = lists.details(
          found.hostId,
          found.instance.project,
          found.instance.name,
        );
        if (!details) throw new Refusal(404, "Instance not found");
        return { ok: true, details };
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/actions/{action}:
   *   post:
   *     summary: Start, stop, restart, freeze, unfreeze or snapshot an instance, through Termix operations
   *     tags:
   *       - Incus
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: project
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: action
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               input:
   *                 type: object
   *     responses:
   *       200:
   *         description: How the run went
   *       400:
   *         description: Not an action, host id or instance name
   *       403:
   *         description: No permission, or Incus is off for the host
   *       404:
   *         description: No such host or instance
   */
  router.post(
    "/hosts/:hostId/instances/:project/:name/actions/:action",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const action = String(req.params.action) as Action;
        if (!ACTIONS.includes(action)) throw new Refusal(400, "Not an action");
        const step = (what: string) =>
          ctx.log.info(
            `action ${action} ${req.params.project}/${req.params.name}: ${what}`,
          );
        step("received");
        const found = await findInstance(req);
        if ("ok" in found) return found;
        const input =
          req.body?.input && typeof req.body.input === "object"
            ? (req.body.input as Record<string, unknown>)
            : {};
        // Termix's operation runner can't hand a plugin process its abort
        // signal yet, so the button runs the action here, with the person's
        // checks the runner would have made.
        if (!(await hasLevel((p) => ctx.rbac.has(p), "operate"))) {
          throw new Refusal(
            403,
            "You don't have permission to operate instances",
          );
        }
        if (!(await ctx.hosts.checkAccess(found.hostId, "edit")).hasAccess) {
          throw new Refusal(403, "Operating needs edit access to the host");
        }
        const resourceKey = `${found.instance.project}/${found.instance.name}`;
        step("checks passed");
        try {
          const summary = await performAction(
            ctx,
            lists,
            action,
            { hostId: found.hostId, resourceKey },
            input,
            (command) => step(`running ${command}`),
          );
          step("done, writing audit");
          await ctx.audit.record({
            action: `incus.${action}`,
            resourceType: "incus-instance",
            resourceId: resourceKey,
            resourceName: found.instance.name,
            details: JSON.stringify({ hostId: found.hostId, input }),
            success: true,
          });
          step("audit written");
          return { ok: true, summary };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await ctx.audit.record({
            action: `incus.${action}`,
            resourceType: "incus-instance",
            resourceId: resourceKey,
            resourceName: found.instance.name,
            success: false,
            errorMessage: message,
          });
          return { ok: false, error: message };
        }
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/summary:
   *   get:
   *     summary: For each host with Incus on that the user can see, how many instances run
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: Each host's counts, or why its Incus didn't answer
   *       403:
   *         description: No permission to read Incus
   */
  router.get("/summary", async (_req: Request, res: Response) => {
    await answer(res, async () => {
      const hosts = [];
      for (const host of await ctx.hosts.list()) {
        const settings = await readHostSettings(ctx, host.id);
        if (!settings.enabled) continue;
        const name = host.name || `${host.username}@${host.ip}`;
        try {
          const rows = await lists.get(host.id, settings);
          const count = (status: string) =>
            rows.filter((r) => r.status === status).length;
          hosts.push({
            id: host.id,
            name,
            ok: true,
            total: rows.length,
            running: count("Running"),
            stopped: count("Stopped"),
            frozen: count("Frozen"),
          });
        } catch (error) {
          if (!(error instanceof ListError)) throw error;
          hosts.push({ id: host.id, name, ok: false, error: error.message });
        }
      }
      return { hosts };
    });
  });
}

export function parseVersion(text: string): {
  client: string | null;
  server: string | null;
} {
  const find = (label: string) =>
    new RegExp(`^${label} version:\\s*(\\S+)`, "mi").exec(text)?.[1] ?? null;
  return { client: find("Client"), server: find("Server") };
}
