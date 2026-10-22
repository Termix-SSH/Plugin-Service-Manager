import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const status = {
  init: "systemd",
  version: "257",
  os: "Debian GNU/Linux 13",
  hostname: "box",
  root: true,
  journal: true,
  failed: 1,
  canEdit: true,
  readOnly: false,
  logRoots: ["/var/log"],
};

const units = [
  {
    name: "cron.service",
    type: "service",
    load: "loaded",
    active: "active",
    sub: "running",
    description: "Regular background program",
    fileState: "enabled",
    preset: "enabled",
  },
  {
    name: "broken.service",
    type: "service",
    load: "loaded",
    active: "failed",
    sub: "failed",
    description: "Broken thing",
    fileState: "disabled",
    preset: "enabled",
  },
];

const detail = {
  name: "cron.service",
  props: {
    Description: "Regular background program",
    ActiveState: "active",
    SubState: "running",
    UnitFileState: "enabled",
    MainPID: "718",
    MemoryCurrent: "380928",
    FragmentPath: "/usr/lib/systemd/system/cron.service",
  },
  status: "cron.service - Regular background program",
};

function api(current: unknown, overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async (url: string) => {
      const path = url.split("?")[0];
      for (const [key, value] of Object.entries(overrides)) {
        if (path.endsWith(key)) return { data: value };
      }
      if (path.endsWith("/status")) return { data: current };
      if (path.endsWith("/units")) return { data: units };
      if (path.endsWith("/units/cron.service")) return { data: detail };
      if (path.endsWith("/watches")) return { data: [] };
      if (path.endsWith("/journal")) {
        return {
          data: {
            entries: [
              {
                time: Date.UTC(2026, 9, 21, 10, 0, 0),
                priority: 6,
                unit: "cron.service",
                ident: "CRON",
                pid: "1",
                message: "job ran",
              },
            ],
            truncated: false,
          },
        };
      }
      return { data: [] };
    }),
    post: vi.fn(async () => ({ data: { state: "active", output: "" } })),
  } as never;
}

const host = {
  id: 1,
  name: "box",
  ip: "10.0.0.1",
  enableSsh: true,
  pluginSettings: { "service-manager": { enableServices: true } },
};

describe(`${manifest.id} frontend`, () => {
  it("registers the tab, host action and terminal panel", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["service-manager"]);
  });

  it("only offers the tab on hosts that turned it on", () => {
    expect(plugin.servicesEnabled(host)).toBe(true);
    expect(plugin.servicesEnabled({ pluginSettings: {} })).toBe(false);
    expect(plugin.servicesPanelEnabled(host)).toBe(true);
    expect(
      plugin.servicesPanelEnabled({
        pluginSettings: {
          "service-manager": { enableServices: true, showPanel: false },
        },
      }),
    ).toBe(false);
  });

  it("lists services with failed ones first", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("service-manager", { isVisible: true, host });
    expect(await screen.findByText("cron.service")).toBeTruthy();
    const names = screen
      .getAllByText(/\.service$/)
      .map((node) => node.textContent);
    expect(names.indexOf("broken.service")).toBeLessThan(
      names.indexOf("cron.service"),
    );
  });

  it("opens a unit with its details and log", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("service-manager", { isVisible: true, host });
    fireEvent.click(await screen.findByText("cron.service"));
    expect(await screen.findByText(locales.detail.memory)).toBeTruthy();
    expect(screen.getByText("372 KB")).toBeTruthy();
    expect(await screen.findByText("job ran")).toBeTruthy();
    expect(screen.getByText(locales.detail.editFile)).toBeTruthy();
  });

  it("hides change buttons without edit access", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({ ...status, canEdit: false }),
    });
    rendered.renderTab("service-manager", { isVisible: true, host });
    fireEvent.click(await screen.findByText("cron.service"));
    await screen.findByText(locales.detail.memory);
    expect(screen.queryByText(locales.actions.stop)).toBeNull();
    expect(screen.queryByText(locales.create.add)).toBeNull();
  });

  it("shows only services and log files on OpenRC", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({ ...status, init: "openrc", journal: false }),
    });
    rendered.renderTab("service-manager", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.viewFiles)).toBeTruthy();
    expect(screen.queryByText(locales.tab.viewTimers)).toBeNull();
    expect(screen.queryByText(locales.tab.viewJournal)).toBeNull();
  });

  it("says when the host has Services turned off", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => {
          throw { response: { data: { error: "off", code: "disabled" } } };
        }),
      } as never,
    });
    rendered.renderTab("service-manager", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.disabled)).toBeTruthy();
  });
});

describe("watched services card", () => {
  it("lists watched units with their host and state", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: ["service-manager.use"],
      hosts: [{ id: "1", name: "box", ip: "10.0.0.1", port: 22 }],
      api: {
        get: vi.fn(async () => ({
          data: [{ hostId: 1, unit: "nginx.service", state: "failed" }],
        })),
      } as never,
    });
    expect(rendered.registered.dashboardCards()).toEqual(["service-watches"]);
    rendered.renderDashboardCard("service-watches");
    expect(await screen.findByText("nginx.service")).toBeTruthy();
    expect(screen.getByText("box")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
