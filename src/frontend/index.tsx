import type { ComponentType } from "react";
import { ServerCog } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import { servicesEnabled, servicesPanelEnabled } from "./enabled";
import { LogsCard, ServicesCard, TimersCard } from "./ManagerCards";
import {
  ServicesCompanion,
  useServicesCompanionDefaults,
} from "./ServicesCompanion";
import { ServicesTab } from "./ServicesTab";
import { WatchesCard } from "./WatchesCard";
import { servicesWidget } from "./ServicesWidget";

export { servicesEnabled, servicesPanelEnabled };

const TAB_ID = "service-manager";

// Fills these cards in Host Metrics, when that plugin runs.
const METRICS_CARDS: Array<[string, string, unknown]> = [
  ["service_manager", "manager.services", ServicesCard],
  ["log_viewer", "manager.logs", LogsCard],
  ["systemd_timers", "manager.timers", TimersCard],
];

export function activate(app: TermixApp): void {
  initApi(app.api);
  // Host actions filter synchronously, so the permission is read once here.
  let canUse = true;
  void app.hasPermission("use").then((allowed) => {
    canUse = allowed;
  });

  app.registerTab(TAB_ID, ServicesTab, {
    icon: ServerCog,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
    persistent: true,
  });
  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.title",
    icon: ServerCog,
    kind: "open",
    order: 47,
    tabType: TAB_ID,
    when: (host) => canUse && !!host.enableSsh && servicesEnabled(host),
  });

  app.registerDashboardCard({
    id: "service-watches",
    titleKey: "card.title",
    defaultPanel: "side",
    defaultHeight: 220,
    frame: "framed",
    component: WatchesCard,
  });

  app.registerCompanion("service-manager", ServicesCompanion, {
    icon: ServerCog,
    titleKey: "tab.title",
    order: 40,
    tabTypes: ["terminal"],
    when: (_tab, host) =>
      canUse && !!host?.enableSsh && servicesPanelEnabled(host),
    useDefaults: useServicesCompanionDefaults,
  });

  app.registerAction("service-manager.togglePanel", ((
    _handle: unknown,
    tab: unknown,
  ) => app.toggleCompanion(tab as never, "service-manager")) as never);
  app.registerSlotContribution("tab.menu", {
    actionId: "service-manager.togglePanel",
    titleKey: "companion.toggle",
    icon: ServerCog,
    kind: "button",
    order: 8,
    when: (context) => {
      const tab = context.tab as {
        type?: string;
        host?: unknown;
        hostConfig?: unknown;
      } | null;
      return (
        tab?.type === "terminal" &&
        servicesPanelEnabled((tab.host ?? tab.hostConfig) as object)
      );
    },
  });

  for (const [actionId, titleKey, component] of METRICS_CARDS) {
    app.registerSlotContribution("host-metrics.managers", {
      actionId,
      titleKey,
      kind: "component",
      component: component as ComponentType<Record<string, unknown>>,
    });
  }
  app.registerExtension("homepage.widgets", servicesWidget);
}
