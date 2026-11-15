const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

export function bytes(value: number | null): string {
  if (value === null) return "";
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n >= 100 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${UNITS[unit]}`;
}

const LIMIT = /^(\d+(?:\.\d+)?)\s*([KMGT]i?B|[KMGT])?$/i;
const POWERS: Record<string, number> = { K: 1, M: 2, G: 3, T: 4 };

// Incus memory limits look like "2GiB", "512MB" or "50%"
export function limitBytes(limit: string | null): number | null {
  const match = limit ? LIMIT.exec(limit.trim()) : null;
  if (!match) return null;
  const unit = match[2] ?? "";
  const power = POWERS[unit.charAt(0).toUpperCase()] ?? 0;
  const base = /i/i.test(unit) || unit.length === 1 ? 1024 : 1000;
  return Number(match[1]) * base ** power;
}

export function percentOf(
  used: number | null,
  total: number | null,
): number | null {
  if (used === null || !total) return null;
  return Math.min(100, Math.round((used / total) * 100));
}
