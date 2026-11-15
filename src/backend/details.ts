export interface ConfigEntry {
  key: string;
  // null when hidden
  value: string | null;
}

export interface DeviceEntry {
  name: string;
  type: string;
  options: ConfigEntry[];
}

export interface SnapshotEntry {
  name: string;
  createdAt: string | null;
  expiresAt: string | null;
  stateful: boolean;
}

export interface InstanceDetails {
  description: string;
  architecture: string | null;
  profiles: string[];
  config: ConfigEntry[];
  devices: DeviceEntry[];
  snapshots: SnapshotEntry[];
  createdAt: string | null;
  lastUsedAt: string | null;
}

const SECRET_NAME =
  /pass(word|wd|phrase)?|secret|token|key|credential|private|auth|cert/i;
const HIDDEN_PREFIX = [
  "environment.",
  "cloud-init.",
  "user.user-data",
  "user.vendor-data",
];

export function isHidden(key: string): boolean {
  return HIDDEN_PREFIX.some((p) => key.startsWith(p)) || SECRET_NAME.test(key);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const time = (v: unknown): string | null => {
  const s = str(v);
  return s && !s.startsWith("0001-") ? s : null;
};

function entries(map: Json): ConfigEntry[] {
  return Object.keys(map)
    .sort()
    .map((key) => ({
      key,
      value: isHidden(key) ? null : String(map[key] ?? ""),
    }));
}

export function parseDetails(raw: unknown): InstanceDetails {
  const i = obj(raw);
  const devices = obj(i.expanded_devices);
  return {
    description: str(i.description) ?? "",
    architecture: str(i.architecture),
    profiles: Array.isArray(i.profiles)
      ? i.profiles.filter((p): p is string => typeof p === "string")
      : [],
    config: entries(obj(i.expanded_config)),
    devices: Object.keys(devices)
      .sort()
      .map((name) => {
        const { type, ...rest } = obj(devices[name]);
        return { name, type: str(type) ?? "", options: entries(rest) };
      }),
    snapshots: (Array.isArray(i.snapshots) ? i.snapshots : []).map((s) => {
      const snap = obj(s);
      const full = str(snap.name) ?? "";
      return {
        name: full.includes("/") ? full.slice(full.lastIndexOf("/") + 1) : full,
        createdAt: time(snap.created_at),
        expiresAt: time(snap.expires_at),
        stateful: snap.stateful === true,
      };
    }),
    createdAt: time(i.created_at),
    lastUsedAt: time(i.last_used_at),
  };
}
