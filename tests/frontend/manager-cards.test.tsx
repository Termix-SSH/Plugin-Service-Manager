import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  hosts: [] as Array<Record<string, unknown>>,
  openTab: vi.fn(),
}));

vi.mock("@termix-ssh/plugin-sdk/frontend", async (original) => ({
  ...(await original<object>()),
  useHosts: () => ({ hosts: mocks.hosts }),
  useTabs: () => ({ openTab: mocks.openTab }),
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));

import { initApi } from "../../src/frontend/api";
import {
  LogsCard,
  ServicesCard,
  TimersCard,
} from "../../src/frontend/ManagerCards";

const pluginSettings = { "service-manager": { enableServices: true } };
const status = {
  init: "systemd",
  version: "257",
  os: "Debian",
  hostname: "box",
  root: true,
  journal: true,
  failed: 0,
  canEdit: true,
  readOnly: false,
  logRoots: ["/var/log"],
};
const unit = {
  name: "cron.service",
  type: "service",
  load: "loaded",
  active: "active",
  sub: "running",
  description: "Cron",
  fileState: "enabled",
  preset: "enabled",
};

function setup(next: Record<string, unknown> = status) {
  const get = vi.fn(async (url: string) => ({
    data: url.includes("/status")
      ? next
      : url.includes("/journal?")
        ? { entries: [] }
        : [],
  }));
  initApi({ get } as never);
  return get;
}

afterEach(() => {
  cleanup();
  mocks.hosts = [];
  vi.clearAllMocks();
});

describe("Host Metrics cards", () => {
  it("draws nothing for an unknown host", () => {
    setup();
    const { container } = render(<ServicesCard hostId={7} />);
    expect(container.textContent).toBe("");
  });

  it("tells the user to turn Services on", async () => {
    const get = setup();
    mocks.hosts = [{ id: 7 }];
    render(<ServicesCard hostId={7} />);
    expect(await screen.findByText("manager.disabled")).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it("lists services", async () => {
    const get = vi.fn(async (url: string) => ({
      data: url.includes("/status") ? status : [unit],
    }));
    initApi({ get } as never);
    mocks.hosts = [{ id: 7, pluginSettings }];
    render(<ServicesCard hostId={7} />);
    expect(await screen.findByText("cron.service")).toBeTruthy();
    expect(screen.queryByTitle("tab.refresh")).toBeNull();
  });

  it("needs systemd for timers", async () => {
    setup({ ...status, init: "openrc" });
    mocks.hosts = [{ id: 7, pluginSettings }];
    render(<TimersCard hostId={7} />);
    expect(await screen.findByText("manager.needsSystemd")).toBeTruthy();
  });

  it("switches logs between the journal and files", async () => {
    setup();
    mocks.hosts = [{ id: 7, pluginSettings }];
    render(<LogsCard hostId={7} />);
    fireEvent.click(await screen.findByText("tab.viewFiles"));
    expect(screen.getByText("tab.viewJournal")).toBeTruthy();
  });

  it("only offers files without a journal", async () => {
    setup({ ...status, journal: false });
    mocks.hosts = [{ id: 7, pluginSettings }];
    render(<LogsCard hostId={7} />);
    await screen.findByText("manager.logs");
    expect(screen.queryByText("tab.viewFiles")).toBeNull();
  });
});
