import { ServerCog } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import {
  ServicesCompanion,
  useServicesCompanionDefaults,
} from "./ServicesCompanion";
import { ServicesTab } from "./ServicesTab";
import { WatchesCard } from "./WatchesCard";

const TAB_ID = "service-manager";

function settingsOf(host: object | null | undefined) {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.[TAB_ID];
}

export function servicesEnabled(host: object | null | undefined): boolean {
  return settingsOf(host)?.enableServices === true;
}

export function servicesPanelEnabled(host: object | null | undefined): boolean {
  return servicesEnabled(host) && settingsOf(host)?.showPanel !== false;
}

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
}
