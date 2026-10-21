import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { logRoots } from "./names.js";

export interface HostSettings {
  enabled: boolean;
  sudo: boolean;
  readOnly: boolean;
  logRoots: string[];
}

export function parseHostSettings(
  values: Record<string, unknown>,
): HostSettings {
  return {
    enabled: values.enableServices === true,
    sudo: values.useSudo !== false,
    readOnly: values.readOnly === true,
    logRoots: logRoots(values.logPaths),
  };
}

export async function readHostSettings(
  ctx: PluginContext,
  hostId: number,
): Promise<HostSettings> {
  return parseHostSettings(await ctx.settings.getAll("host", hostId));
}
