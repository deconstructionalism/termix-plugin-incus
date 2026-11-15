// Only the fields listed here leave the backend. Config and devices carry
// secrets (environment.*), so nothing is copied from them wholesale.

export interface InstanceAddress {
  family: "inet" | "inet6";
  address: string;
  interface: string;
}

export interface InstanceDisk {
  device: string;
  usage: number | null;
  total: number | null;
}

export interface InstanceRow {
  name: string;
  project: string;
  type: "container" | "virtual-machine";
  status: string;
  description: string;
  image: string | null;
  profiles: string[];
  createdAt: string | null;
  startedAt: string | null;
  addresses: InstanceAddress[];
  cpu: { usageNs: number | null; percent: number | null; limit: string | null };
  memory: {
    usage: number | null;
    peak: number | null;
    swap: number | null;
    limit: string | null;
  };
  disks: InstanceDisk[];
  network: { received: number; sent: number } | null;
  processes: number | null;
  // a VM reports CPU, addresses and processes only through its agent
  agent: boolean | null;
  // host uid of the instance's root, to show processes' users as inside
  idmapBase: number | null;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const str = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
// Incus reports -1 or 0 for what it couldn't measure
const measured = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};
const time = (value: unknown): string | null => {
  const s = str(value);
  return s && !s.startsWith("0001-") ? s : null;
};

function imageLabel(config: Json): string | null {
  const description = str(config["image.description"]);
  if (description) return description;
  const parts = [config["image.os"], config["image.release"]]
    .map(str)
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function addresses(network: Json): InstanceAddress[] {
  const out: InstanceAddress[] = [];
  for (const [name, raw] of Object.entries(network)) {
    if (name === "lo") continue;
    for (const entry of (obj(raw).addresses as unknown[]) ?? []) {
      const a = obj(entry);
      const family =
        a.family === "inet" || a.family === "inet6" ? a.family : null;
      const address = str(a.address);
      if (!family || !address || a.scope !== "global") continue;
      out.push({ family, address, interface: name });
    }
  }
  return out;
}

function traffic(network: Json): { received: number; sent: number } | null {
  let received = 0;
  let sent = 0;
  let any = false;
  for (const [name, raw] of Object.entries(network)) {
    if (name === "lo") continue;
    const counters = obj(obj(raw).counters);
    const r = num(counters.bytes_received);
    const s = num(counters.bytes_sent);
    if (r === null && s === null) continue;
    any = true;
    received += r ?? 0;
    sent += s ?? 0;
  }
  return any ? { received, sent } : null;
}

function disks(state: Json, devices: Json): InstanceDisk[] {
  const reported = obj(state.disk);
  const names = new Set<string>(Object.keys(reported));
  for (const [name, raw] of Object.entries(devices)) {
    if (obj(raw).type === "disk" && str(obj(raw).pool)) names.add(name);
  }
  return [...names].sort().map((device) => {
    const d = obj(reported[device]);
    return { device, usage: measured(d.usage), total: measured(d.total) };
  });
}

// Root inside is this host uid: the uid entry of volatile.idmap.current that
// maps container id 0. volatile.idmap.base can say "0" while the map starts
// at 1000000, so it's only a fallback.
function idmapBase(config: Json): number | null {
  const current = str(config["volatile.idmap.current"]);
  if (current !== null) {
    try {
      const entries: unknown = JSON.parse(current);
      if (Array.isArray(entries)) {
        for (const raw of entries) {
          const e = obj(raw);
          if (
            e.Isuid === true &&
            e.Nsid === 0 &&
            typeof e.Hostid === "number"
          ) {
            return e.Hostid;
          }
        }
      }
    } catch {
      // fall through to base
    }
  }
  const base = str(config["volatile.idmap.base"]);
  return base !== null && /^\d+$/.test(base) ? Number(base) : null;
}

export function parseInstance(raw: unknown): InstanceRow | null {
  const i = obj(raw);
  const name = str(i.name);
  if (!name) return null;
  const type = i.type === "virtual-machine" ? "virtual-machine" : "container";
  const config = obj(i.expanded_config);
  const devices = obj(i.expanded_devices);
  const state = obj(i.state);
  const network = obj(state.network);
  const memory = obj(state.memory);
  const running = str(state.status ?? i.status) === "Running";
  const processes = num(state.processes);
  const agent =
    type === "virtual-machine" && running
      ? processes !== null && processes >= 0
      : null;
  return {
    name,
    project: str(i.project) ?? "default",
    type,
    status: str(state.status) ?? str(i.status) ?? "Unknown",
    description: str(i.description) ?? "",
    image: imageLabel(config),
    profiles: Array.isArray(i.profiles)
      ? i.profiles.filter((p): p is string => typeof p === "string")
      : [],
    createdAt: time(i.created_at),
    startedAt: running ? time(state.started_at) : null,
    addresses: addresses(network),
    cpu: {
      usageNs: running ? measured(obj(state.cpu).usage) : null,
      percent: null,
      limit: str(config["limits.cpu"]),
    },
    memory: {
      usage: running ? measured(memory.usage) : null,
      peak: running ? measured(memory.usage_peak) : null,
      swap: running ? measured(memory.swap_usage) : null,
      limit: str(config["limits.memory"]),
    },
    disks: disks(state, devices),
    network: running ? traffic(network) : null,
    processes:
      running && processes !== null && processes >= 0 ? processes : null,
    agent,
    idmapBase: idmapBase(config),
  };
}

export function parseInstances(text: string): InstanceRow[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed))
    throw new Error("incus list didn't return a list");
  return parsed
    .map(parseInstance)
    .filter((row): row is InstanceRow => row !== null)
    .sort((a, b) =>
      a.project === b.project
        ? a.name.localeCompare(b.name)
        : a.project.localeCompare(b.project),
    );
}

export interface Sample {
  at: number;
  cpu: Map<string, number>;
}

const key = (row: InstanceRow) => `${row.project}/${row.name}`;

// CPU usage is a running total, so a percentage needs the previous reading
export function withCpuPercent(
  rows: InstanceRow[],
  previous: Sample | null,
  at: number,
): { rows: InstanceRow[]; sample: Sample } {
  const sample: Sample = { at, cpu: new Map() };
  const elapsedNs = previous ? (at - previous.at) * 1e6 : 0;
  const out = rows.map((row) => {
    if (row.cpu.usageNs === null) return row;
    sample.cpu.set(key(row), row.cpu.usageNs);
    const before = previous?.cpu.get(key(row));
    if (before === undefined || elapsedNs <= 0 || row.cpu.usageNs < before) {
      return row;
    }
    const percent = ((row.cpu.usageNs - before) / elapsedNs) * 100;
    return {
      ...row,
      cpu: { ...row.cpu, percent: Math.round(percent * 10) / 10 },
    };
  });
  return { rows: out, sample };
}
