import { ServicesError } from "./errors.js";

/** Wraps a value in single quotes for bash. */
export function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const UNIT_TYPES = [
  "service",
  "socket",
  "timer",
  "target",
  "mount",
  "automount",
  "path",
  "swap",
  "slice",
  "scope",
  "device",
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

// Backslash is allowed for escaped names like dev-disk-by\x2duuid.
const UNIT_RE = new RegExp(
  `^[A-Za-z0-9_][A-Za-z0-9:_.@\\\\-]{0,250}\\.(${UNIT_TYPES.join("|")})$`,
);
const OPENRC_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,127}$/;

export function isUnit(name: unknown): name is string {
  return typeof name === "string" && UNIT_RE.test(name);
}

export function unitType(name: string): UnitType {
  return name.slice(name.lastIndexOf(".") + 1) as UnitType;
}

/** Units we may write a file for. Templates and device style names are out. */
export function isWritableUnitName(name: string): boolean {
  return (
    isUnit(name) &&
    !name.includes("\\") &&
    ["service", "socket", "timer", "target", "path", "mount"].includes(
      unitType(name),
    )
  );
}

export function isOpenRcName(name: unknown): name is string {
  return typeof name === "string" && OPENRC_RE.test(name);
}

export function requireUnit(name: unknown): string {
  if (!isUnit(name)) throw new ServicesError("That is not a valid unit name");
  return name;
}

/** A unit name or, on OpenRC, a service name. */
export function requireService(name: unknown, init: string): string {
  if (init === "openrc") {
    if (!isOpenRcName(name)) {
      throw new ServicesError("That is not a valid service name");
    }
    return name;
  }
  return requireUnit(name);
}

/** The log folders a host allows, from its logPaths setting. */
export function logRoots(setting: unknown): string[] {
  const raw = typeof setting === "string" && setting.trim() ? setting : "";
  const roots = (raw || "/var/log")
    .split(/[,\n]/)
    .map((part) => part.trim().replace(/\/+$/, ""))
    .filter((part) => part && isCleanPath(part));
  return roots.length ? [...new Set(roots)] : ["/var/log"];
}

function isCleanPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    path.length < 1024 &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(path) &&
    !path.split("/").some((part) => part === ".." || part === ".")
  );
}

/**
 * A log file path inside one of the roots. The script checks the real path
 * again on the host, so a symlink can't lead outside.
 */
export function requireLogPath(path: unknown, roots: string[]): string {
  if (typeof path !== "string" || !isCleanPath(path)) {
    throw new ServicesError("That is not a valid file path");
  }
  if (!roots.some((root) => path.startsWith(`${root}/`))) {
    throw new ServicesError(
      "That file is outside the allowed log folders",
      403,
    );
  }
  return path;
}
