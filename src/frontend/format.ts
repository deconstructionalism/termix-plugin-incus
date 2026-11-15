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

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

// a plain line diff (longest common subsequence), enough for a config file
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (
      i < a.length &&
      (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  return out;
}
