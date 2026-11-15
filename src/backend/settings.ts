import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";

export const LEVELS = ["read", "operate", "manage"] as const;
export type Level = (typeof LEVELS)[number];

// never free text: these go in a command line
export const INCUS_COMMANDS = {
  incus: ["incus"],
  sudo: ["sudo", "-n", "incus"],
} as const;
export type IncusCommand = keyof typeof INCUS_COMMANDS;

export const INSTANCE_NAME = /^[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const SHELL_PATH = /^\/[A-Za-z0-9_./-]{1,200}$/;

export interface IncusHostSettings {
  enabled: boolean;
  level: Level;
  protected: string[];
  allowShell: boolean;
  shell: string | null;
  allowReveal: boolean;
  incusCommand: IncusCommand;
  pollSeconds: number;
}

export function parseLevel(value: unknown): Level {
  return LEVELS.includes(value as Level) ? (value as Level) : "read";
}

export function levelAllows(host: Level, needed: Level): boolean {
  return LEVELS.indexOf(host) >= LEVELS.indexOf(needed);
}

export function parseProtected(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const names = value
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter((name) => INSTANCE_NAME.test(name));
  return [...new Set(names)];
}

export function parseShell(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!SHELL_PATH.test(path) || path.split("/").includes("..")) return null;
  return path;
}

export function parsePollSeconds(value: unknown): number {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds)) return 15;
  return Math.min(300, Math.max(10, Math.round(seconds)));
}

// anything missing or not understood falls back to the safest value
export function normalizeHostSettings(
  values: Record<string, unknown>,
): IncusHostSettings {
  return {
    enabled: values.enableIncus === true,
    level: parseLevel(values.level),
    protected: parseProtected(values.protected),
    allowShell: values.allowShell === true,
    shell: parseShell(values.shell),
    allowReveal: values.allowReveal === true,
    incusCommand: values.incusCommand === "sudo" ? "sudo" : "incus",
    pollSeconds: parsePollSeconds(values.pollSeconds),
  };
}

export async function readHostSettings(
  ctx: PluginContext,
  hostId: number,
): Promise<IncusHostSettings> {
  return normalizeHostSettings(await ctx.settings.getAll("host", hostId));
}
