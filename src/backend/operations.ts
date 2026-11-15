import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { incus } from "./commands.js";
import type { InstanceRow } from "./instances.js";
import type { InstanceLists } from "./list.js";
import {
  INSTANCE_NAME,
  levelAllows,
  PROJECT_NAME,
  readHostSettings,
  type IncusHostSettings,
} from "./settings.js";

export const SNAPSHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const EXPIRIES = ["", "1d", "7d", "30d"];

export const ACTIONS = [
  "start",
  "stop",
  "restart",
  "freeze",
  "unfreeze",
  "snapshot-create",
  "snapshot-restore",
  "snapshot-delete",
] as const;
export type Action = (typeof ACTIONS)[number];

// what the protected list blocks: anything that stops it or throws work away
const PROTECTED_BLOCKS: Action[] = [
  "stop",
  "restart",
  "freeze",
  "snapshot-restore",
  "snapshot-delete",
];

const DONE: Record<Action, string> = {
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
  freeze: "Froze",
  unfreeze: "Unfroze",
  "snapshot-create": "Took a snapshot of",
  "snapshot-restore": "Restored",
  "snapshot-delete": "Deleted a snapshot of",
};

export function parseResourceKey(key: string | undefined): {
  project: string;
  name: string;
} {
  const [project = "", name = "", ...rest] = (key ?? "").split("/");
  if (rest.length || !PROJECT_NAME.test(project) || !INSTANCE_NAME.test(name)) {
    throw new Error("Not an instance");
  }
  return { project, name };
}

export function actionWords(
  action: Action,
  instance: { project: string; name: string },
  input: Record<string, unknown>,
): string[] {
  const p = ["--project", instance.project];
  const snapshot = String(input.snapshot ?? "");
  switch (action) {
    case "start":
      return ["start", ...p, "--", instance.name];
    case "stop":
      return ["stop", ...p, "--timeout", "60", "--", instance.name];
    case "restart":
      return ["restart", ...p, "--timeout", "60", "--", instance.name];
    case "freeze":
      return ["pause", ...p, "--", instance.name];
    case "unfreeze":
      return ["resume", ...p, "--", instance.name];
    case "snapshot-create": {
      const name = String(input.name ?? "");
      const expiry = String(input.expiry ?? "");
      if (name && !SNAPSHOT_NAME.test(name))
        throw new Error("Not a snapshot name");
      if (!EXPIRIES.includes(expiry)) throw new Error("Not an expiry");
      return [
        "snapshot",
        "create",
        ...p,
        ...(expiry ? ["--expiry", expiry] : []),
        "--",
        instance.name,
        ...(name ? [name] : []),
      ];
    }
    case "snapshot-restore":
    case "snapshot-delete":
      if (!SNAPSHOT_NAME.test(snapshot)) throw new Error("Not a snapshot name");
      return [
        "snapshot",
        action === "snapshot-restore" ? "restore" : "delete",
        ...p,
        "--",
        instance.name,
        snapshot,
      ];
  }
}

function hostOf(context: { hostId?: number }): number {
  if (context.hostId === undefined) throw new Error("This needs a host");
  return context.hostId;
}

async function operable(
  ctx: PluginContext,
  lists: InstanceLists,
  action: Action,
  context: { hostId?: number; resourceKey?: string },
  input: Record<string, unknown>,
): Promise<{
  hostId: number;
  settings: IncusHostSettings;
  instance: InstanceRow;
}> {
  const hostId = hostOf(context);
  const settings = await readHostSettings(ctx, hostId);
  if (!settings.enabled) throw new Error("Incus isn't turned on for this host");
  if (!levelAllows(settings.level, "operate")) {
    throw new Error("This host doesn't allow operating instances");
  }
  const { project, name } = parseResourceKey(context.resourceKey);
  if (PROTECTED_BLOCKS.includes(action) && settings.protected.includes(name)) {
    throw new Error(`${name} is protected on this host`);
  }
  const instance = (await lists.get(hostId, settings)).find(
    (i) => i.project === project && i.name === name,
  );
  if (!instance) throw new Error("Instance not found");
  if (action === "snapshot-restore" || action === "snapshot-delete") {
    const snapshot = String(input.snapshot ?? "");
    const known = lists.details(hostId, project, name)?.snapshots ?? [];
    if (!known.some((s) => s.name === snapshot)) {
      throw new Error("No such snapshot");
    }
  }
  return { hostId, settings, instance };
}

// Shared by the Termix operation and the plugin's own route. Checks the host,
// the instance, protection and snapshots; the caller checks the person.
export async function performAction(
  ctx: PluginContext,
  lists: InstanceLists,
  action: Action,
  target: { hostId?: number; resourceKey?: string },
  input: Record<string, unknown>,
  log: (line: string) => void = () => {},
): Promise<string> {
  const { hostId, settings, instance } = await operable(
    ctx,
    lists,
    action,
    target,
    input,
  );
  const command = incus(
    settings.incusCommand,
    actionWords(action, instance, input),
  );
  log(command);
  const result = await ctx.ssh.exec(hostId, command, {
    purpose: "incus",
    stdin: "",
    timeoutMs: 150_000,
    maxOutputBytes: 64 * 1024,
  });
  lists.forget(hostId);
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim().slice(0, 500) ||
        `incus ${action} failed`,
    );
  }
  return `${DONE[action]} ${instance.name}`;
}

export function registerOperations(
  ctx: PluginContext,
  lists: InstanceLists,
): void {
  if (typeof ctx.operations?.register !== "function") return;

  ctx.operations.register("incus.list-instances", {
    run: async (_input, context) => {
      const hostId = hostOf(context);
      const settings = await readHostSettings(ctx, hostId);
      if (!settings.enabled)
        throw new Error("Incus isn't turned on for this host");
      const rows = (await lists.get(hostId, settings)).map((i) => ({
        key: `${i.project}/${i.name}`,
        name: i.name,
        status: i.status,
        type: i.type === "virtual-machine" ? "VM" : "Container",
        project: i.project,
        address: i.addresses.find((a) => a.family === "inet")?.address ?? "",
      }));
      return { summary: `${rows.length} instances`, data: { rows } };
    },
  });

  for (const action of ACTIONS) {
    ctx.operations.register(`incus.${action}`, {
      describe: (input, context) => {
        const { name } = parseResourceKey(context.resourceKey);
        const snapshot = input.snapshot ? ` (${String(input.snapshot)})` : "";
        return `Would run ${action.replace("-", " ")} on ${name}${snapshot}`;
      },
      run: async (input, context) => ({
        summary: await performAction(
          ctx,
          lists,
          action,
          context,
          input,
          context.log,
        ),
        changed: true,
      }),
    });
  }
}
