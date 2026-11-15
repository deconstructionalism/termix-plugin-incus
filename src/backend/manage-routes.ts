import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { Refusal, requireHost } from "./access.js";
import { incus } from "./commands.js";
import type { InstanceLists } from "./list.js";
import {
  createWords,
  ManageError,
  MAX_YAML,
  parseProfiles,
  prepareEdit,
  redactConfig,
  revealValue,
} from "./manage.js";
import {
  INSTANCE_NAME,
  PROJECT_NAME,
  type IncusHostSettings,
} from "./settings.js";

const LONG = 600_000;

export function registerManageRoutes(
  router: Router,
  ctx: PluginContext,
  lists: InstanceLists,
): void {
  const run = async (
    hostId: number,
    settings: IncusHostSettings,
    words: string[],
    options: { stdin?: string; timeoutMs?: number } = {},
  ): Promise<string> => {
    const result = await ctx.ssh.exec(
      hostId,
      incus(settings.incusCommand, words),
      {
        purpose: "incus",
        stdin: options.stdin ?? "",
        timeoutMs: options.timeoutMs ?? 60_000,
        maxOutputBytes: 1024 * 1024,
      },
    );
    if (result.code !== 0) {
      throw new ManageError(
        400,
        (result.stderr || result.stdout).trim().slice(0, 500) || "incus failed",
      );
    }
    return result.stdout;
  };

  const audit = (
    action: string,
    resource: string,
    details: unknown,
    error?: string,
  ) =>
    ctx.audit.record({
      action: `incus.${action}`,
      resourceType: "incus-instance",
      resourceId: resource,
      details: JSON.stringify(details),
      success: error === undefined,
      ...(error === undefined ? {} : { errorMessage: error }),
    });

  // Manage permission, edit access, a manage host, and checked names
  const target = async (req: Request, mustExist = true) => {
    const project = String(
      req.params.project ?? req.body?.project ?? "default",
    );
    const name = String(req.params.name ?? req.body?.name ?? "");
    if (!PROJECT_NAME.test(project) || !INSTANCE_NAME.test(name)) {
      throw new Refusal(400, "Not an instance name");
    }
    const { hostId, settings } = await requireHost(
      ctx,
      req.params.hostId,
      "manage",
    );
    const instance = (await lists.get(hostId, settings)).find(
      (i) => i.project === project && i.name === name,
    );
    if (mustExist && !instance) throw new Refusal(404, "Instance not found");
    if (!mustExist && instance) throw new Refusal(400, "That name is taken");
    return { hostId, settings, project, name, instance };
  };

  const guard = (settings: IncusHostSettings, name: string) => {
    if (settings.protected.includes(name)) {
      throw new Refusal(403, `${name} is protected on this host`);
    }
  };

  const answer = async (res: Response, work: () => Promise<unknown>) => {
    try {
      res.json(await work());
    } catch (error) {
      if (error instanceof Refusal) {
        res.status(error.status).json({ error: error.message });
      } else if (error instanceof ManageError) {
        res.json({
          ok: false,
          conflict: error.status === 409,
          error: error.message,
        });
      } else {
        throw error;
      }
    }
  };

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/profiles:
   *   get:
   *     summary: The profile names in a project, for creating an instance
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: The names
   *       403:
   *         description: No permission, or the host doesn't allow managing
   */
  router.get("/hosts/:hostId/profiles", async (req: Request, res: Response) => {
    await answer(res, async () => {
      const project = String(req.query.project ?? "default");
      if (!PROJECT_NAME.test(project))
        throw new Refusal(400, "Not a project name");
      const { hostId, settings } = await requireHost(
        ctx,
        req.params.hostId,
        "manage",
      );
      const out = await run(hostId, settings, [
        "profile",
        "list",
        "--project",
        project,
        "--format",
        "json",
      ]);
      return { ok: true, profiles: parseProfiles(out) };
    });
  });

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances:
   *   post:
   *     summary: Create an instance from an image
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: How it went
   *       400:
   *         description: A bad or taken name
   *       403:
   *         description: No permission, or the host doesn't allow managing
   */
  router.post(
    "/hosts/:hostId/instances",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const { hostId, settings, project, name } = await target(req, false);
        const body = req.body ?? {};
        const request = {
          project,
          name,
          image: String(body.image ?? ""),
          profiles: Array.isArray(body.profiles)
            ? body.profiles.map(String)
            : [],
          vm: body.vm === true,
          start: body.start !== false,
        };
        const words = createWords(request);
        try {
          await run(hostId, settings, words, { timeoutMs: LONG });
        } catch (error) {
          await audit(
            "create",
            `${project}/${name}`,
            request,
            (error as Error).message,
          );
          throw error;
        } finally {
          lists.forget(hostId);
        }
        await audit("create", `${project}/${name}`, request);
        return { ok: true, summary: `Created ${name}` };
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/config:
   *   get:
   *     summary: An instance's own config as YAML, secret looking values replaced by a placeholder
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: The YAML and a version to send back with an edit
   *       403:
   *         description: No permission, or the host doesn't allow managing
   *       404:
   *         description: No such host or instance
   */
  router.get(
    "/hosts/:hostId/instances/:project/:name/config",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const { hostId, settings, project, name } = await target(req);
        const raw = await run(hostId, settings, [
          "config",
          "show",
          "--project",
          project,
          "--",
          name,
        ]);
        return {
          ok: true,
          ...redactConfig(raw),
          protected: settings.protected.includes(name),
          allowReveal: settings.allowReveal,
        };
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/config:
   *   put:
   *     summary: Apply an edited config, keeping untouched hidden values, unless it changed meanwhile
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: How it went, with conflict set when the config changed since it was read
   *       403:
   *         description: No permission, a protected instance, or the host doesn't allow managing
   *       404:
   *         description: No such host or instance
   */
  router.put(
    "/hosts/:hostId/instances/:project/:name/config",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const { hostId, settings, project, name } = await target(req);
        guard(settings, name);
        const yaml = String(req.body?.yaml ?? "");
        const version = String(req.body?.version ?? "");
        if (!yaml || yaml.length > MAX_YAML)
          throw new Refusal(400, "No config given");
        const show = ["config", "show", "--project", project, "--", name];
        const full = prepareEdit(
          yaml,
          version,
          await run(hostId, settings, show),
        );
        try {
          await run(
            hostId,
            settings,
            ["config", "edit", "--project", project, "--", name],
            {
              stdin: full,
            },
          );
        } catch (error) {
          await audit(
            "config-edit",
            `${project}/${name}`,
            {},
            (error as Error).message,
          );
          throw error;
        } finally {
          lists.forget(hostId);
        }
        await audit("config-edit", `${project}/${name}`, {});
        return { ok: true, summary: `Saved ${name}'s config` };
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/reveal:
   *   post:
   *     summary: Show one hidden config value, on hosts that allow it, recorded in the audit log
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: The value
   *       403:
   *         description: No permission, or the host doesn't allow revealing
   *       404:
   *         description: No such host or instance
   */
  router.post(
    "/hosts/:hostId/instances/:project/:name/reveal",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const { hostId, settings, project, name } = await target(req);
        if (!settings.allowReveal) {
          throw new Refusal(
            403,
            "This host doesn't allow revealing hidden values",
          );
        }
        const key = String(req.body?.key ?? "");
        const device = req.body?.device ? String(req.body.device) : undefined;
        const raw = await run(hostId, settings, [
          "config",
          "show",
          "--project",
          project,
          "--",
          name,
        ]);
        const value = revealValue(raw, key, device);
        await audit("reveal", `${project}/${name}`, { key, device });
        return { ok: true, value };
      });
    },
  );

  /**
   * @openapi
   * /plugin-api/incus/hosts/{hostId}/instances/{project}/{name}/manage/{verb}:
   *   post:
   *     summary: Copy, rename or delete an instance
   *     tags:
   *       - Incus
   *     responses:
   *       200:
   *         description: How it went
   *       400:
   *         description: Not a verb or a name, or the instance must be stopped first
   *       403:
   *         description: No permission, a protected instance, or the host doesn't allow managing
   *       404:
   *         description: No such host or instance
   */
  router.post(
    "/hosts/:hostId/instances/:project/:name/manage/:verb",
    async (req: Request, res: Response) => {
      await answer(res, async () => {
        const verb = String(req.params.verb);
        if (!["copy", "rename", "delete"].includes(verb)) {
          throw new Refusal(400, "Not something this can do");
        }
        const { hostId, settings, project, name, instance } = await target(req);
        const newName = String(req.body?.newName ?? "");
        const resource = `${project}/${name}`;
        let words: string[];
        let summary: string;
        if (verb === "delete") {
          guard(settings, name);
          if (req.body?.confirm !== name)
            throw new Refusal(400, "Type the instance's name to delete it");
          if (instance!.status !== "Stopped")
            throw new Refusal(400, "Stop the instance first");
          words = ["delete", "--project", project, "--", name];
          summary = `Deleted ${name}`;
        } else {
          if (!INSTANCE_NAME.test(newName))
            throw new Refusal(400, "Not an instance name");
          const taken = (await lists.get(hostId, settings)).some(
            (i) => i.project === project && i.name === newName,
          );
          if (taken) throw new Refusal(400, "That name is taken");
          if (verb === "rename") {
            guard(settings, name);
            if (instance!.status !== "Stopped")
              throw new Refusal(400, "Stop the instance first");
            words = ["rename", "--project", project, "--", name, newName];
            summary = `Renamed ${name} to ${newName}`;
          } else {
            words = ["copy", "--project", project, "--", name, newName];
            summary = `Copied ${name} to ${newName}`;
          }
        }
        try {
          await run(hostId, settings, words, { timeoutMs: LONG });
        } catch (error) {
          await audit(verb, resource, { newName }, (error as Error).message);
          throw error;
        } finally {
          lists.forget(hostId);
        }
        await audit(verb, resource, { newName });
        return { ok: true, summary };
      });
    },
  );
}
