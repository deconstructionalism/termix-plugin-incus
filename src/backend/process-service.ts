import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { commandLine, incus } from "./commands.js";
import type { InstanceRow } from "./instances.js";
import {
  cgroupName,
  containerProcesses,
  instanceProcesses,
  MAX_PROCESSES,
  parseSnapshot,
  PROCESS_SCRIPT,
  withCpu,
  type ProcessRow,
  type Snapshot,
} from "./processes.js";
import type { IncusHostSettings } from "./settings.js";

export class ProcessError extends Error {
  constructor(
    readonly reason: "no-agent" | "stopped" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

const GUEST_PATH =
  "PATH=/run/current-system/sw/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const FRESH_MS = 3_000;

interface Slot {
  now: Snapshot | null;
  before: Snapshot | null;
  pending: Promise<Snapshot> | null;
}

export class Processes {
  private slots = new Map<string, Slot>();

  constructor(
    private ctx: PluginContext,
    private clock: () => number = Date.now,
  ) {}

  async list(
    hostId: number,
    settings: IncusHostSettings,
    instance: InstanceRow,
  ): Promise<{ processes: ProcessRow[]; truncated: boolean }> {
    if (instance.status !== "Running") {
      throw new ProcessError("stopped", "The instance isn't running");
    }
    let rows: ProcessRow[];
    let slot: Slot;
    if (instance.type === "container") {
      slot = await this.snapshot(`host:${hostId}`, () =>
        this.run(hostId, commandLine(["sh", "-s"])),
      );
      rows = containerProcesses(
        slot.now!,
        cgroupName(instance.project, instance.name),
        instance.idmapBase,
      );
    } else {
      if (instance.agent === false) {
        throw new ProcessError("no-agent", "This VM has no Incus agent");
      }
      slot = await this.snapshot(
        `vm:${hostId}:${instance.project}/${instance.name}`,
        () =>
          this.run(
            hostId,
            incus(settings.incusCommand, [
              "exec",
              "--project",
              instance.project,
              "--env",
              GUEST_PATH,
              "--",
              instance.name,
              "sh",
              "-s",
            ]),
          ),
      );
      rows = instanceProcesses(slot.now!);
    }
    const withPercent = withCpu(rows, slot.now!, slot.before);
    return {
      processes: withPercent.slice(0, MAX_PROCESSES),
      truncated: withPercent.length > MAX_PROCESSES,
    };
  }

  private async snapshot(
    key: string,
    fetch: () => Promise<string>,
  ): Promise<Slot> {
    const slot = this.slots.get(key) ?? {
      now: null,
      before: null,
      pending: null,
    };
    this.slots.set(key, slot);
    if (slot.pending) {
      await slot.pending;
      return slot;
    }
    if (slot.now && this.clock() - slot.now.at < FRESH_MS) return slot;
    slot.pending = fetch()
      .then((text) => {
        const next = parseSnapshot(text, this.clock());
        slot.before = slot.now;
        slot.now = next;
        return next;
      })
      .finally(() => {
        slot.pending = null;
      });
    await slot.pending;
    return slot;
  }

  private async run(hostId: number, command: string): Promise<string> {
    const result = await this.ctx.ssh.exec(hostId, command, {
      purpose: "incus",
      stdin: PROCESS_SCRIPT,
      timeoutMs: 20_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (result.truncated) {
      throw new ProcessError(
        "failed",
        "The process list was too large to read",
      );
    }
    if (result.code !== 0 || !result.stdout.includes("---")) {
      throw new ProcessError(
        "failed",
        (result.stderr || result.stdout).trim().slice(0, 300) ||
          "Couldn't list processes",
      );
    }
    return result.stdout;
  }
}
