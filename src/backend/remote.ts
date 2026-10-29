import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  SUDO_REFUSED_RE,
  scriptError,
  scriptShell,
  scrub,
} from "@termix-ssh/plugin-sdk/host-scripts";
import { ServicesError } from "./errors.js";

export {
  parseKeys,
  scriptError,
  scrub,
  streamCommand,
  watchdog,
} from "@termix-ssh/plugin-sdk/host-scripts";

/** Root, or passwordless sudo. Fails on anything else. */
export const ROOT_SHELL = scriptShell("root");

export interface RunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Return the output even when the script exits non zero. */
  allowFail?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface Remote {
  /** Runs a change as root. Uses passwordless sudo when `sudo` is on. */
  root: (
    hostId: number,
    sudo: boolean,
    script: string,
    options?: RunOptions,
  ) => Promise<RunResult>;
  /** Runs a read as root when it can, else as the login user. */
  read: (
    hostId: number,
    sudo: boolean,
    script: string,
    options?: RunOptions,
  ) => Promise<RunResult>;
}

export function createRemote(ctx: PluginContext): Remote {
  async function run(
    hostId: number,
    shell: string,
    script: string,
    options: RunOptions,
  ): Promise<RunResult> {
    const result = await ctx.ssh.exec(hostId, shell, {
      stdin: script,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxOutputBytes: options.maxOutputBytes,
      purpose: "service-manager",
    });
    if (result.timedOut) throw new ServicesError("The host took too long", 504);
    if (result.code !== 0 && !options.allowFail) {
      if (SUDO_REFUSED_RE.test(result.stderr)) {
        throw new ServicesError(
          "This host needs passwordless sudo, or a root login",
          400,
          { code: "sudo" },
        );
      }
      const own = scriptError(result.stdout);
      throw new ServicesError(
        scrub(own || result.stderr || result.stdout || "Command failed", 1500),
      );
    }
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  }

  return {
    root: (hostId, sudo, script, options = {}) =>
      run(hostId, scriptShell(sudo ? "root" : "root-only"), script, {
        timeoutMs: 60_000,
        ...options,
      }),
    read: (hostId, sudo, script, options = {}) =>
      run(hostId, scriptShell(sudo ? "auto" : "plain"), script, options),
  };
}
