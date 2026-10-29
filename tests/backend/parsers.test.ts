import { describe, expect, it } from "vitest";
import { logRoots, requireLogPath } from "../../src/backend/names.js";
import { parseFileList, tailScript } from "../../src/backend/logfiles.js";

// Unit, journal and OpenRC parsing is tested in the SDK, where it lives now.
describe("names", () => {
  it("reads log roots and keeps paths inside them", () => {
    expect(logRoots("")).toEqual(["/var/log"]);
    expect(logRoots("/var/log, /opt/app/logs/")).toEqual([
      "/var/log",
      "/opt/app/logs",
    ]);
    expect(logRoots("relative, /a/../b")).toEqual(["/var/log"]);
    const roots = ["/var/log"];
    expect(requireLogPath("/var/log/syslog", roots)).toBe("/var/log/syslog");
    expect(() => requireLogPath("/var/log/../../etc/shadow", roots)).toThrow();
    expect(() => requireLogPath("/var/logs/x", roots)).toThrow(/outside/);
    expect(() => requireLogPath("/etc/shadow", roots)).toThrow(/outside/);
    expect(() => requireLogPath("/var/log/a\nb", roots)).toThrow();
  });
});

describe("log files", () => {
  it("parses the file list", () => {
    const files = parseFileList(
      "120|1792602185|/var/log/syslog\n5|1792602000|/var/log/old.log.2.gz\nbad line\n",
    );
    expect(files).toEqual([
      {
        path: "/var/log/old.log.2.gz",
        size: 5,
        modified: 1792602000000,
        compressed: true,
      },
      {
        path: "/var/log/syslog",
        size: 120,
        modified: 1792602185000,
        compressed: false,
      },
    ]);
  });

  it("checks the real path on the host and quotes the search", () => {
    const script = tailScript("/var/log/syslog", ["/var/log"], 50, "a'b");
    expect(script).toContain(`readlink -f -- "$P"`);
    expect(script).toContain(`grep -i -F -e 'a'\\''b'`);
    expect(tailScript("/var/log/x.gz", ["/var/log"], 10, "")).toContain(
      "gzip -dc",
    );
  });
});
