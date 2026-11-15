import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  levelAllows,
  readHostSettings,
  type IncusHostSettings,
  type Level,
} from "./settings.js";

export class Refusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

const LEVEL_PERMISSION: Record<Level, string> = {
  read: "read",
  operate: "operate",
  manage: "manage",
};

export interface AllowedHost {
  hostId: number;
  settings: IncusHostSettings;
}

export function parseHostId(value: unknown): number {
  const id = typeof value === "string" ? Number(value) : value;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new Refusal(400, "A host id is a positive whole number");
  }
  return id;
}

// reading needs connect access to the host, anything else edit
export async function requireHost(
  ctx: PluginContext,
  rawHostId: unknown,
  needed: Level,
): Promise<AllowedHost> {
  const hostId = parseHostId(rawHostId);
  if (!(await ctx.rbac.has(LEVEL_PERMISSION[needed]))) {
    throw new Refusal(403, "You don't have permission for this");
  }
  const access = await ctx.hosts.checkAccess(
    hostId,
    needed === "read" ? "connect" : "edit",
  );
  if (!access.hasAccess) throw new Refusal(404, "Host not found");
  const settings = await readHostSettings(ctx, hostId);
  if (!settings.enabled) {
    throw new Refusal(403, "Incus isn't turned on for this host");
  }
  if (!levelAllows(settings.level, needed)) {
    throw new Refusal(403, "This host doesn't allow that");
  }
  return { hostId, settings };
}
