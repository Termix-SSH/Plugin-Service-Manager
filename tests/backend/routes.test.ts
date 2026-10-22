import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const DETECT =
  "init=systemd\nversion=257\nos=Debian\nhostname=box\nuid=0\njournal=1\nfailed=1\n";

async function start(options: Parameters<typeof startServer>[0] = {}) {
  server = await startServer(options);
  server.ssh.replies.push(
    { match: 'echo "init=$INIT"', stdout: DETECT },
    {
      match: "list-units --all",
      stdout:
        "cron.service loaded active running Cron\n@@TERMIX_FILES@@\ncron.service enabled enabled\n",
    },
    { match: "systemctl start --", stdout: "state=active\n" },
    { match: "systemctl is-active", stdout: "active\n" },
  );
  return server;
}

describe("services routes", () => {
  it("reports status for a host", async () => {
    const s = await start();
    const res = await s.request("GET", "/1/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      init: "systemd",
      root: true,
      failed: 1,
      canEdit: true,
      logRoots: ["/var/log"],
    });
  });

  it("needs the use permission", async () => {
    const s = await start({ permissions: [] });
    const res = await s.request("GET", "/1/status");
    expect(res.status).toBe(403);
  });

  it("hides hosts the user can't reach", async () => {
    const s = await start({ level: "none" });
    expect((await s.request("GET", "/1/units")).status).toBe(404);
  });

  it("refuses a host with Services turned off", async () => {
    const s = await start({ hostSettings: { enableServices: false } });
    const res = await s.request("GET", "/1/units");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("disabled");
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("lists units", async () => {
    const s = await start();
    const res = await s.request("GET", "/1/units?type=service");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      name: "cron.service",
      active: "active",
    });
  });

  it("runs an action as root and audits it", async () => {
    const s = await start();
    const res = await s.request("POST", "/1/units/cron.service/actions/start");
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
    const call = s.ssh.calls.find((c) => c.stdin.includes("systemctl start"));
    expect(call?.command).toContain("sudo -n");
    expect(call?.stdin).toContain("systemctl start -- 'cron.service'");
    expect(s.mock.audits.at(-1)).toMatchObject({
      action: "service-manager.unit_action",
      success: true,
    });
  });

  it("refuses bad names and actions", async () => {
    const s = await start();
    expect(
      (await s.request("POST", "/1/units/a;b.service/actions/start")).status,
    ).toBe(400);
    expect(
      (await s.request("POST", "/1/units/cron.service/actions/explode")).status,
    ).toBe(400);
  });

  it("needs edit access for changes", async () => {
    const s = await start({ level: "connect" });
    expect((await s.request("GET", "/1/units")).status).toBe(200);
    const res = await s.request("POST", "/1/units/cron.service/actions/stop");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("HOST_EDIT_REQUIRED");
    const status = await s.request("GET", "/1/status");
    expect(status.body.canEdit).toBe(false);
  });

  it("blocks every change on a read only host", async () => {
    const s = await start({ hostSettings: { readOnly: true } });
    for (const [method, path, body] of [
      ["POST", "/1/units/cron.service/actions/restart"],
      ["PUT", "/1/units/cron.service/file", { target: "override", text: "" }],
      ["DELETE", "/1/units/cron.service/file"],
      ["POST", "/1/units", { name: "x", execStart: "/bin/true" }],
      ["POST", "/1/journal/vacuum", { time: "4w" }],
    ] as const) {
      const res = await s.request(method, path, body);
      expect(res.status, path).toBe(403);
      expect(res.body.code).toBe("readOnly");
    }
    expect(s.ssh.calls.some((c) => c.stdin.includes("systemctl restart"))).toBe(
      false,
    );
  });

  it("uses no sudo when it is turned off", async () => {
    const s = await start({ hostSettings: { useSudo: false } });
    await s.request("POST", "/1/units/cron.service/actions/start");
    const call = s.ssh.calls.find((c) => c.stdin.includes("systemctl start"));
    expect(call?.command).not.toContain("sudo -n");
  });

  it("keeps log reads inside the log folders", async () => {
    const s = await start({ hostSettings: { logPaths: "/srv/logs" } });
    const outside = await s.request("GET", "/1/logs/file?path=/var/log/syslog");
    expect(outside.status).toBe(403);
    const inside = await s.request(
      "GET",
      "/1/logs/file?path=/srv/logs/app.log&lines=5",
    );
    expect(inside.status).toBe(200);
  });

  it("passes a failed check back without saving", async () => {
    const s = await start();
    s.ssh.replies.unshift({
      match: "systemd-analyze verify",
      stdout: "SERVICES_ERR:x.service: Unknown key\n",
      code: 1,
    });
    const res = await s.request("PUT", "/1/units/cron.service/file", {
      target: "override",
      text: "[Service]\nBogus=1\n",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unknown key");
    expect(s.mock.audits.at(-1)).toMatchObject({ success: false });
  });

  it("says when sudo needs a password", async () => {
    const s = await start();
    s.ssh.replies.unshift({
      match: "systemctl stop",
      stderr: "sudo: a password is required",
      code: 1,
    });
    const res = await s.request("POST", "/1/units/cron.service/actions/stop");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("sudo");
  });

  it("adds, lists and removes watches per user", async () => {
    const s = await start();
    expect(
      (await s.request("POST", "/1/watches", { unit: "cron.service" })).status,
    ).toBe(200);
    expect((await s.request("GET", "/1/watches")).body).toEqual([
      { unit: "cron.service", state: "" },
    ]);
    s.mock.setActor("user-2");
    expect((await s.request("GET", "/1/watches")).body).toEqual([]);
    s.mock.setActor("user-1");
    await s.request("DELETE", "/1/watches/cron.service");
    expect((await s.request("GET", "/1/watches")).body).toEqual([]);
  });
});

describe("every watched unit", () => {
  it("lists the user's watches on every host with their state", async () => {
    const s = await start();
    await s.request("POST", "/1/watches", { unit: "cron.service" });
    await s.mock.runScheduled();
    expect((await s.request("GET", "/watches")).body).toEqual([
      { hostId: 1, unit: "cron.service", state: "active" },
    ]);
    s.mock.setActor("user-2");
    expect((await s.request("GET", "/watches")).body).toEqual([]);
  });
});

describe("watch alerts", () => {
  it("alerts once when a unit goes down and once when it is back", async () => {
    const s = await start();
    await s.request("POST", "/1/watches", { unit: "cron.service" });
    const reply = s.ssh.replies.find((r) => r.match === "systemctl is-active")!;

    await s.mock.runScheduled();
    expect(s.mock.notifications).toHaveLength(0);

    reply.stdout = "failed\n";
    await s.mock.runScheduled();
    await s.mock.runScheduled();
    expect(s.mock.notifications).toHaveLength(1);
    expect(s.mock.notifications[0].notification).toMatchObject({
      severity: "critical",
      category: "service-manager.unit_failed",
      audience: { userId: "user-1" },
    });

    reply.stdout = "active\n";
    await s.mock.runScheduled();
    expect(s.mock.notifications).toHaveLength(2);
    expect(s.mock.notifications[1].notification.category).toBe(
      "service-manager.unit_recovered",
    );
  });

  it("skips hosts the watcher lost access to", async () => {
    const s = await start();
    await s.request("POST", "/1/watches", { unit: "cron.service" });
    Object.assign(s.mock.ctx.hosts, {
      checkAccess: async () => ({
        hasAccess: false,
        isOwner: false,
        isShared: false,
      }),
    });
    await s.mock.runScheduled();
    expect(s.ssh.calls.some((c) => c.stdin.includes("is-active"))).toBe(false);
  });
});
