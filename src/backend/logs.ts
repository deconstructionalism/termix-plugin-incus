import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { commandLine, incus } from "./commands.js";
import type { InstanceRow } from "./instances.js";
import { cgroupName } from "./processes.js";
import type { IncusHostSettings } from "./settings.js";

export const GUEST_PATH =
  "PATH=/run/current-system/sw/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const LOG_LINES = 500;
const LOG_DIR = "/var/log/incus";

export type LogSource = "journal" | "console";

export type LogAnswer =
  | { ok: true; source: LogSource; text: string; truncated: boolean }
  | {
      ok: false;
      reason: "no-agent" | "no-source" | "unreadable" | "failed";
      error: string;
      path?: string;
    };

const NOT_FOUND =
  /not found|no such file|executable file not found|exit status 127/i;
const DENIED = /permission denied/i;

export async function readLogs(
  ctx: PluginContext,
  hostId: number,
  settings: IncusHostSettings,
  instance: InstanceRow,
): Promise<LogAnswer> {
  const run = (command: string) =>
    ctx.ssh.exec(hostId, command, {
      purpose: "incus",
      timeoutMs: 20_000,
      maxOutputBytes: 1024 * 1024,
    });
  const running = instance.status === "Running";

  if (
    running &&
    !(instance.type === "virtual-machine" && instance.agent === false)
  ) {
    const journal = await run(
      incus(settings.incusCommand, [
        "exec",
        "--project",
        instance.project,
        "--env",
        GUEST_PATH,
        "--",
        instance.name,
        "journalctl",
        "--no-pager",
        "-n",
        String(LOG_LINES),
        "-o",
        "short-iso",
      ]),
    );
    if (journal.code === 0) {
      return {
        ok: true,
        source: "journal",
        text: journal.stdout,
        truncated: journal.truncated,
      };
    }
    if (!NOT_FOUND.test(journal.stderr + journal.stdout)) {
      return {
        ok: false,
        reason: "failed",
        error: firstLine(journal.stderr || journal.stdout),
      };
    }
  }

  if (instance.type === "virtual-machine") {
    if (running && instance.agent === false) {
      return {
        ok: false,
        reason: "no-agent",
        error: "This VM has no Incus agent",
      };
    }
    if (running) {
      return { ok: false, reason: "no-source", error: "No journal in this VM" };
    }
  }

  // A running container's console buffer is consumed by reading it, so read
  // the file LXC writes the same output to instead. Stopped instances are
  // served from that file by Incus itself.
  const path = `${LOG_DIR}/${cgroupName(instance.project, instance.name)}/console.log`;
  const console = running
    ? await run(commandLine(["tail", "-n", String(LOG_LINES), "--", path]))
    : await run(
        incus(settings.incusCommand, [
          "console",
          "--project",
          instance.project,
          "--show-log",
          "--",
          instance.name,
        ]),
      );
  if (console.code === 0) {
    return {
      ok: true,
      source: "console",
      text: lastLines(console.stdout),
      truncated: console.truncated,
    };
  }
  const why = console.stderr + console.stdout;
  if (DENIED.test(why)) {
    return { ok: false, reason: "unreadable", error: firstLine(why), path };
  }
  if (NOT_FOUND.test(why)) {
    return { ok: false, reason: "no-source", error: firstLine(why) };
  }
  return { ok: false, reason: "failed", error: firstLine(why) };
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.slice(0, 300) || "Couldn't read the logs";
}

function lastLines(text: string): string {
  const lines = text.split("\n");
  return lines.length > LOG_LINES + 1
    ? lines.slice(-LOG_LINES - 1).join("\n")
    : text;
}
