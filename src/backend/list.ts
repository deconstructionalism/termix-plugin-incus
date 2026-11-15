import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { incus } from "./commands.js";
import { parseDetails, type InstanceDetails } from "./details.js";
import {
  parseInstances,
  withCpuPercent,
  type InstanceRow,
  type Sample,
} from "./instances.js";
import type { IncusHostSettings } from "./settings.js";

export class ListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListError";
  }
}

interface Entry {
  at: number;
  rows: InstanceRow[];
  sample: Sample | null;
  details: Map<string, InstanceDetails>;
  pending: Promise<InstanceRow[]> | null;
}

const MAX_OUTPUT = 4 * 1024 * 1024;

// one request at a time per host, shared by everyone looking at it
export class InstanceLists {
  private entries = new Map<number, Entry>();

  constructor(
    private ctx: PluginContext,
    private now: () => number = Date.now,
  ) {}

  async get(
    hostId: number,
    settings: IncusHostSettings,
  ): Promise<InstanceRow[]> {
    const entry = this.entries.get(hostId) ?? {
      at: 0,
      rows: [],
      sample: null,
      details: new Map(),
      pending: null,
    };
    this.entries.set(hostId, entry);
    if (entry.pending) return entry.pending;
    const fresh =
      entry.at > 0 && this.now() - entry.at < settings.pollSeconds * 800;
    if (fresh) return entry.rows;
    entry.pending = this.fetch(hostId, settings, entry).finally(() => {
      entry.pending = null;
    });
    return entry.pending;
  }

  // from the latest list, already redacted
  details(
    hostId: number,
    project: string,
    name: string,
  ): InstanceDetails | null {
    return this.entries.get(hostId)?.details.get(`${project}/${name}`) ?? null;
  }

  forget(hostId: number): void {
    this.entries.delete(hostId);
  }

  private async fetch(
    hostId: number,
    settings: IncusHostSettings,
    entry: Entry,
  ): Promise<InstanceRow[]> {
    const result = await this.ctx.ssh.exec(
      hostId,
      incus(settings.incusCommand, [
        "list",
        "--all-projects",
        "--format",
        "json",
      ]),
      { purpose: "incus", timeoutMs: 30_000, maxOutputBytes: MAX_OUTPUT },
    );
    if (result.truncated) {
      throw new ListError("Incus's answer was too large to read");
    }
    if (result.code !== 0) {
      throw new ListError(
        (result.stderr || result.stdout).trim().slice(0, 500) ||
          "incus list failed",
      );
    }
    let rows: InstanceRow[];
    const details = new Map<string, InstanceDetails>();
    try {
      rows = parseInstances(result.stdout);
      for (const raw of JSON.parse(result.stdout) as unknown[]) {
        const i = raw as { name?: unknown; project?: unknown };
        if (typeof i.name !== "string") continue;
        const project =
          typeof i.project === "string" && i.project ? i.project : "default";
        details.set(`${project}/${i.name}`, parseDetails(raw));
      }
    } catch {
      throw new ListError("Incus's answer wasn't readable");
    }
    const at = this.now();
    const { rows: withCpu, sample } = withCpuPercent(rows, entry.sample, at);
    entry.at = at;
    entry.rows = withCpu;
    entry.sample = sample;
    entry.details = details;
    return withCpu;
  }
}
