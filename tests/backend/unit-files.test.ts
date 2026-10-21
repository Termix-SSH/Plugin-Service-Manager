import { describe, expect, it } from "vitest";
import {
  parseFileView,
  parseNewService,
  parseVerify,
  requireUnitText,
  saveScript,
  serviceText,
  timerText,
} from "../../src/backend/unit-files.js";

describe("new service form", () => {
  it("fills defaults and writes the unit", () => {
    const input = parseNewService({
      name: "my-app",
      execStart: "/usr/bin/node /opt/app/server.js",
      user: "app",
      environment: ["NODE_ENV=production", "GREETING=hello world"],
    });
    expect(input.name).toBe("my-app.service");
    const text = serviceText(input);
    expect(text).toContain("ExecStart=/usr/bin/node /opt/app/server.js");
    expect(text).toContain("User=app");
    expect(text).toContain('Environment="GREETING=hello world"');
    expect(text).toContain("Restart=on-failure");
    expect(text).toContain("WantedBy=multi-user.target");
  });

  it("makes a oneshot and a timer for a schedule", () => {
    const input = parseNewService({
      name: "backup",
      execStart: "/usr/local/bin/backup",
      onCalendar: "daily",
    });
    expect(serviceText(input)).toContain("Type=oneshot");
    expect(serviceText(input)).not.toContain("[Install]");
    expect(timerText(input)).toContain("OnCalendar=daily");
    expect(timerText(input)).toContain("Unit=backup.service");
  });

  it("refuses unsafe or broken input", () => {
    const base = { name: "x", execStart: "/bin/true" };
    expect(() => parseNewService({ ...base, name: "../x" })).toThrow();
    expect(() => parseNewService({ ...base, execStart: "true" })).toThrow();
    expect(() =>
      parseNewService({ ...base, execStart: "/bin/true\nExecStartPre=/x" }),
    ).toThrow(/one line/);
    expect(() => parseNewService({ ...base, user: "root;id" })).toThrow();
    expect(() =>
      parseNewService({ ...base, environment: ["no equals"] }),
    ).toThrow();
    expect(() => parseNewService({ ...base, wantedBy: "x.service" })).toThrow();
  });
});

describe("unit files", () => {
  it("takes text with a final newline and no control bytes", () => {
    expect(requireUnitText("[Unit]", false)).toBe("[Unit]\n");
    expect(requireUnitText("", true)).toBe("");
    expect(() => requireUnitText("", false)).toThrow();
    expect(() => requireUnitText("a\u0001", false)).toThrow();
  });

  it("verifies before writing and sends the text as base64", () => {
    const text = "[Service]\nExecStart=/bin/echo '$(id)'\n";
    const script = saveScript("x.service", "override", text);
    expect(script).toContain(Buffer.from(text).toString("base64"));
    expect(script).not.toContain("$(id)");
    expect(script.indexOf("systemd-analyze verify")).toBeLessThan(
      script.indexOf("daemon-reload"),
    );
    expect(script).toContain("/etc/systemd/system/x.service.d/override.conf");
  });

  it("removes an empty override", () => {
    const script = saveScript("x.service", "override", "");
    expect(script).toContain("rm -f --");
    expect(script).not.toContain("systemd-analyze");
  });

  it("checks a new unit does not exist yet", () => {
    expect(
      saveScript("x.service", "unit", "[Unit]\n", { mustBeNew: true }),
    ).toContain("already exists");
  });

  it("reads the file view and check output", () => {
    const view = parseFileView(
      "x.service",
      [
        "fragment=/etc/systemd/system/x.service",
        "dropins=/etc/systemd/system/x.service.d/override.conf",
        "@@TERMIX_CAT@@",
        "# /etc/systemd/system/x.service",
        "[Unit]",
        "@@TERMIX_FRAG@@",
        "[Unit]",
        "@@TERMIX_OVERRIDE@@",
        "[Service]",
        "Environment=A=1",
        "",
      ].join("\n"),
    );
    expect(view).toMatchObject({
      fragmentPath: "/etc/systemd/system/x.service",
      fragment: "[Unit]",
      override: "[Service]\nEnvironment=A=1",
      local: true,
      writable: true,
      dropIns: ["/etc/systemd/system/x.service.d/override.conf"],
    });
    expect(parseVerify("rc=1\n@@TERMIX_OUT@@\nbad key\n")).toEqual({
      ok: false,
      output: "bad key",
    });
    expect(parseVerify("rc=0\n@@TERMIX_OUT@@\n\n").ok).toBe(true);
  });
});
