import { ServicesError } from "./errors.js";

export {
  UNIT_TYPES,
  isOpenRcName,
  isUnit,
  isWritableUnitName,
  requireService,
  requireUnit,
  shellQuote as q,
  unitType,
  type UnitType,
} from "@termix-ssh/plugin-sdk/host-scripts";

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
