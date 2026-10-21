import type { JournalEntry, UnitSummary } from "../shared/types";

export type Tone = "success" | "destructive" | "warning" | "muted" | "brand";

export function stateTone(active: string): Tone {
  if (active === "active" || active === "reloading") return "success";
  if (active === "failed") return "destructive";
  if (active === "activating" || active === "deactivating") return "warning";
  return "muted";
}

export function dotClass(active: string): string {
  switch (stateTone(active)) {
    case "success":
      return "bg-green-500";
    case "destructive":
      return "bg-destructive";
    case "warning":
      return "bg-warning";
    default:
      return "bg-muted-foreground/40";
  }
}

export function bytes(value: string | number | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || value === "" || value === undefined) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size >= 10 || i === 0 ? Math.round(size) : size.toFixed(1)} ${units[i]}`;
}

/** systemd times come back in UTC, like "Wed 2026-10-21 10:38:12 UTC". */
export function parseUtc(value: string | undefined): number | null {
  if (!value) return null;
  const match = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export function dateTime(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

export function timeOnly(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** A short span like 3d 4h or 12m. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function cpu(nsec: string | undefined): string {
  const n = Number(nsec);
  if (!nsec || !Number.isFinite(n)) return "";
  const s = n / 1e9;
  return s < 60 ? `${s.toFixed(1)}s` : span(s * 1000);
}

export function notSet(value: string | undefined): boolean {
  return !value || value === "[not set]" || value === "infinity";
}

export const PRIORITY_NAMES = [
  "emerg",
  "alert",
  "crit",
  "err",
  "warning",
  "notice",
  "info",
  "debug",
];

export function priorityClass(priority: number): string {
  if (priority <= 3) return "text-destructive";
  if (priority === 4) return "text-warning";
  if (priority === 7) return "text-muted-foreground";
  return "";
}

export function entryText(entry: JournalEntry): string {
  const who = entry.ident || entry.unit;
  return `${timeOnly(entry.time)} ${who}${entry.pid ? `[${entry.pid}]` : ""}: ${entry.message}`;
}

/** Failed first, then running, then the rest, each by name. */
export function sortUnits(units: UnitSummary[]): UnitSummary[] {
  const rank = (u: UnitSummary) =>
    u.active === "failed" ? 0 : u.active === "active" ? 1 : 2;
  return [...units].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
}
