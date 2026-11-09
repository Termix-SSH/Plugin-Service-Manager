import type {
  PluginContext,
  PluginOperationContext,
} from "@termix-ssh/plugin-sdk/backend";
import { UNIT_ACTIONS, type UnitAction } from "../shared/types.js";
import { ServicesError } from "./errors.js";
import { readHostSettings, type HostSettings } from "./host-settings.js";
import type { Manager } from "./manager.js";
import { requireService } from "./names.js";

function requireHost(context: PluginOperationContext): number {
  if (context.hostId === undefined) throw new Error("This needs a host");
  return context.hostId;
}

/** Everything Services offers to the rest of Termix. */
export function registerOperations(ctx: PluginContext, manager: Manager): void {
  const settingsFor = async (
    hostId: number,
    change: boolean,
  ): Promise<HostSettings> => {
    const settings = await readHostSettings(ctx, hostId);
    if (change && settings.readOnly) {
      throw new ServicesError("This host is read only", 403);
    }
    return settings;
  };

  ctx.operations.register("service-manager.list-services", {
    run: async (_input, context) => {
      const hostId = requireHost(context);
      const settings = await settingsFor(hostId, false);
      const rows = await manager.units(hostId, settings, "service");
      return { summary: `${rows.length} services`, data: { rows } };
    },
  });

  ctx.operations.register("service-manager.failed-units", {
    run: async (_input, context) => {
      const hostId = requireHost(context);
      const found = await manager.detect(
        hostId,
        await settingsFor(hostId, false),
      );
      return {
        summary: `${found.failed} failed`,
        data: {
          value: found.failed,
          status: found.failed > 0 ? "fail" : "ok",
          label: `${found.failed} failed`,
        },
      };
    },
  });

  for (const action of UNIT_ACTIONS as readonly UnitAction[]) {
    ctx.operations.register(`service-manager.${action}`, {
      describe: (_input, context) =>
        `Would ${action} ${context.resourceKey ?? "this service"}`,
      run: async (_input, context) => {
        const hostId = requireHost(context);
        const settings = await settingsFor(hostId, true);
        const init = await manager.initOf(hostId, settings);
        const unit = requireService(context.resourceKey ?? "", init);
        const data = await manager.action(hostId, settings, unit, action);
        return { summary: `${unit}: ${action} done`, changed: true, data };
      },
    });
  }
}
