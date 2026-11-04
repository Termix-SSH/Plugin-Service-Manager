function settingsOf(host: object | null | undefined) {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.["service-manager"];
}

export function servicesEnabled(host: object | null | undefined): boolean {
  return settingsOf(host)?.enableServices === true;
}

export function servicesPanelEnabled(host: object | null | undefined): boolean {
  return servicesEnabled(host) && settingsOf(host)?.showPanel !== false;
}
