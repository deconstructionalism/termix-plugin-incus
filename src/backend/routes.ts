import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { Refusal, requireHost } from "./access.js";
import { incus } from "./commands.js";
import { InstanceLists, ListError } from "./list.js";
import { Processes, ProcessError } from "./process-service.js";
import { INSTANCE_NAME, PROJECT_NAME, readHostSettings } from "./settings.js";

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

export function registerRoutes(router: Router, ctx: PluginContext): void {
  router.use(ctx.rbac.require("read") as never);
  const lists = new InstanceLists(ctx);
  const processes = new Processes(ctx);

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
        { purpose: "incus", timeoutMs: 15_000, maxOutputBytes: 4096 },
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
        let instance;
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
        try {
          return {
            ok: true,
            ...(await processes.list(hostId, settings, instance)),
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
}

export function parseVersion(text: string): {
  client: string | null;
  server: string | null;
} {
  const find = (label: string) =>
    new RegExp(`^${label} version:\\s*(\\S+)`, "mi").exec(text)?.[1] ?? null;
  return { client: find("Client"), server: find("Server") };
}
