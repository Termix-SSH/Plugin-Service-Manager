import type { UnitAction, UnitSummary } from "../shared/types.js";
import { ServicesError } from "./errors.js";
import { q } from "./names.js";

export const OPENRC_LIST_SCRIPT = `
rc-status --servicelist 2>/dev/null
echo "@@TERMIX_RUNLEVELS@@"
rc-update show -v 2>/dev/null
exit 0
`;

/** Maps OpenRC states to the words systemd uses, so the UI has one set. */
function activeOf(state: string): { active: string; sub: string } {
  switch (state) {
    case "started":
      return { active: "active", sub: "running" };
    case "crashed":
      return { active: "failed", sub: "crashed" };
    case "starting":
      return { active: "activating", sub: "starting" };
    case "stopping":
      return { active: "deactivating", sub: "stopping" };
    case "inactive":
    case "hotplugged":
      return { active: "inactive", sub: state };
    default:
      return { active: "inactive", sub: state || "stopped" };
  }
}

export function parseOpenRcList(output: string): UnitSummary[] {
  const [list = "", levels = ""] = output.split("@@TERMIX_RUNLEVELS@@");
  const units = new Map<string, UnitSummary>();
  for (const line of list.split("\n")) {
    const match = /^\s*(\S+)\s+\[\s*([a-z ]+?)\s*\]/.exec(line);
    if (!match) continue;
    const { active, sub } = activeOf(match[2]);
    units.set(match[1], {
      name: match[1],
      type: "service",
      load: "loaded",
      active,
      sub,
      description: "",
      fileState: "disabled",
      preset: "",
    });
  }
  for (const line of levels.split("\n")) {
    const match = /^\s*(\S+)\s*\|\s*(.*)$/.exec(line);
    if (!match) continue;
    const runlevels = match[2].trim();
    const known = units.get(match[1]) ?? {
      name: match[1],
      type: "service",
      load: "loaded",
      active: "inactive",
      sub: "stopped",
      description: "",
      fileState: "disabled",
      preset: "",
    };
    known.fileState = runlevels ? "enabled" : "disabled";
    known.description = runlevels ? `Runlevels: ${runlevels}` : "";
    units.set(match[1], known);
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function openRcActionScript(name: string, action: UnitAction): string {
  const s = q(name);
  switch (action) {
    case "start":
    case "stop":
    case "restart":
      return `rc-service ${s} ${action} 2>&1 || { echo "SERVICES_ERR:rc-service ${action} failed"; exit 1; }\n`;
    case "enable":
      return `rc-update add ${s} default 2>&1 || { echo "SERVICES_ERR:rc-update add failed"; exit 1; }\n`;
    case "disable":
      return `rc-update del ${s} 2>&1 || { echo "SERVICES_ERR:rc-update del failed"; exit 1; }\n`;
    default:
      throw new ServicesError("OpenRC can't do that", 400);
  }
}

export function openRcStatusScript(name: string): string {
  return `rc-service ${q(name)} status 2>&1; rc-update show -v 2>/dev/null | grep -E '^ *'${q(name)}' *\\|'; exit 0\n`;
}
