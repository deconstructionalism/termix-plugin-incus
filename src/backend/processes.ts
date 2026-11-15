export interface ProcessRow {
  pid: number;
  uid: number;
  // the user id inside the instance, when it can be worked out
  innerUid: number | null;
  cpuPercent: number | null;
  rss: number;
  elapsedSeconds: number;
  threads: number;
  command: string;
}

// Fixed text, sent on stdin to `sh -s`; nothing from a request goes in it.
export const PROCESS_SCRIPT = [
  "getconf CLK_TCK 2>/dev/null || echo 100",
  "echo ---",
  "ps -eww -o pid=,uid=,rss=,etimes=,nlwp=,args=",
  "echo ---",
  "cat /proc/[0-9]*/stat 2>/dev/null",
  "echo ---",
  // ps cuts its cgroup column at 27 characters, so read the kernel's own
  "grep -H '' /proc/[0-9]*/cgroup 2>/dev/null",
  "",
].join("\n");

export const MAX_PROCESSES = 1000;

const SECRET_ARG =
  /((?:^|[\s,;])-{0,2}[\w.-]*(?:pass(?:word|wd)?|secret|token|api[-_]?key|private[-_]?key|credentials?)[\w.-]*)(=|\s+)("[^"]*"|'[^']*'|\S+)/gi;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi;

// values after secret looking names are blanked, as for config keys
export function redactArgs(command: string): string {
  return command
    .replace(URL_PASSWORD, "$1***@")
    .replace(SECRET_ARG, (_m, name: string, sep: string) => `${name}${sep}***`);
}

// The first lxc.payload component only: a container can make cgroups of any
// name below its own, as Incus itself notes.
export function containerFromCgroup(cgroup: string): string | null {
  for (const line of cgroup.split(/[;\n]/)) {
    const at = line.indexOf(":/");
    if (at < 0) continue;
    for (const part of line.slice(at + 2).split("/")) {
      if (part.startsWith("lxc.payload.")) {
        return part.slice("lxc.payload.".length) || null;
      }
      if (part.startsWith("lxc.monitor.")) return null;
    }
  }
  return null;
}

export function cgroupName(project: string, name: string): string {
  return project === "default" ? name : `${project}_${name}`;
}

interface Ticks {
  cpu: number;
  start: number;
}

// /proc/<pid>/stat: the command sits in parentheses and may hold spaces
export function parseStat(text: string): Map<number, Ticks> {
  const out = new Map<number, Ticks>();
  for (const line of text.split("\n")) {
    const close = line.lastIndexOf(")");
    if (close < 0) continue;
    const pid = Number(line.slice(0, line.indexOf(" ")));
    const f = line.slice(close + 2).split(" ");
    const utime = Number(f[11]);
    const stime = Number(f[12]);
    const start = Number(f[19]);
    if ([pid, utime, stime, start].every(Number.isFinite)) {
      out.set(pid, { cpu: utime + stime, start });
    }
  }
  return out;
}

export interface Snapshot {
  hz: number;
  at: number;
  ticks: Map<number, Ticks>;
  rows: Array<{ row: ProcessRow; cgroup: string }>;
}

// grep -H lines: "/proc/<pid>/cgroup:<hierarchy line>"
export function parseCgroups(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const m = /^\/proc\/(\d+)\/cgroup:(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const before = out.get(pid);
    out.set(pid, before ? `${before};${m[2]}` : m[2]);
  }
  return out;
}

export function parseSnapshot(text: string, at: number): Snapshot {
  const [hzText = "", psText = "", statText = "", cgroupText = ""] =
    text.split(/^---$/m);
  const hz = Number(hzText.trim()) > 0 ? Number(hzText.trim()) : 100;
  const cgroups = parseCgroups(cgroupText);
  const rows: Snapshot["rows"] = [];
  for (const line of psText.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [pid, uid, rss, elapsed, threads] = parts.slice(0, 5).map(Number);
    if (![pid, uid, rss, elapsed, threads].every(Number.isFinite)) continue;
    rows.push({
      cgroup: cgroups.get(pid) ?? "",
      row: {
        pid,
        uid,
        innerUid: null,
        cpuPercent: null,
        rss: rss * 1024,
        elapsedSeconds: elapsed,
        threads,
        command: redactArgs(parts.slice(5).join(" ")),
      },
    });
  }
  return { hz, at, ticks: parseStat(statText), rows };
}

// CPU over the time since the previous snapshot, for the same process
// (same pid and start time) only
export function withCpu(
  rows: ProcessRow[],
  now: Snapshot,
  before: Snapshot | null,
): ProcessRow[] {
  if (!before || now.at <= before.at) return rows;
  const seconds = (now.at - before.at) / 1000;
  return rows.map((row) => {
    const a = before.ticks.get(row.pid);
    const b = now.ticks.get(row.pid);
    if (!a || !b || a.start !== b.start || b.cpu < a.cpu) return row;
    const percent = ((b.cpu - a.cpu) / now.hz / seconds) * 100;
    return { ...row, cpuPercent: Math.round(percent * 10) / 10 };
  });
}

export function containerProcesses(
  snapshot: Snapshot,
  name: string,
  idmapBase: number | null,
): ProcessRow[] {
  return snapshot.rows
    .filter((entry) => containerFromCgroup(entry.cgroup) === name)
    .map(({ row }) => ({ ...row, innerUid: innerUid(row.uid, idmapBase) }));
}

export function instanceProcesses(snapshot: Snapshot): ProcessRow[] {
  return snapshot.rows.map(({ row }) => ({ ...row, innerUid: row.uid }));
}

function innerUid(uid: number, idmapBase: number | null): number | null {
  if (idmapBase === null) return uid < 65536 ? uid : null;
  const inner = uid - idmapBase;
  return inner >= 0 && inner < 1_000_000_000 ? inner : null;
}
