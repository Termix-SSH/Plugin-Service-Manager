import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { ServicesError } from "./errors.js";

// systemctl and friends often live in sbin, which a normal login skips.
// TZ=UTC so systemctl prints every time in UTC, which parses the same anywhere.
const ENV = "SYSTEMD_COLORS=0 SYSTEMD_PAGER=cat LC_ALL=C TZ=UTC";
const SBIN = `export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin"; export ${ENV}; `;
const SUDO = `sudo -n env PATH="$PATH" ${ENV}`;

/** Root, or passwordless sudo. Fails on anything else. */
export const ROOT_SHELL =
  SBIN +
  `if [ "$(id -u)" = "0" ]; then exec bash -s; else exec ${SUDO} bash -s; fi`;
/** Root only, for hosts where sudo is turned off. */
const ROOT_ONLY_SHELL =
  SBIN +
  'if [ "$(id -u)" = "0" ]; then exec bash -s; else echo "SERVICES_ERR:This needs root, or turn on Use sudo for this host"; exit 1; fi';
/** Root when it can be had without a password, else the login user. */
const AUTO_SHELL =
  SBIN +
  `if [ "$(id -u)" = "0" ]; then exec bash -s; elif sudo -n true 2>/dev/null; then exec ${SUDO} bash -s; else exec bash -s; fi`;
const PLAIN_SHELL = SBIN + "exec bash -s";

/** Trims output and keeps it short enough to show. */
export function scrub(text: string, max = 600): string {
  return text.trim().slice(0, max);
}

const SUDO_HINT = /password is required|a terminal is required|no tty present/i;

/** Scripts print SERVICES_ERR: lines before a non zero exit to explain a failure. */
export function scriptError(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("SERVICES_ERR:"))
    .map((line) => line.slice("SERVICES_ERR:".length))
    .join("\n")
    .trim();
}

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
      if (SUDO_HINT.test(result.stderr)) {
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
      run(hostId, sudo ? ROOT_SHELL : ROOT_ONLY_SHELL, script, {
        timeoutMs: 60_000,
        ...options,
      }),
    read: (hostId, sudo, script, options = {}) =>
      run(hostId, sudo ? AUTO_SHELL : PLAIN_SHELL, script, options),
  };
}

/** Reads key=value lines. Only the first = splits a line. */
export function parseKeys(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Runs a long command in the background and stops it once stdin closes,
 * which happens when the SSH channel ends. A pty can't be trusted for this:
 * sudo keeps its own and the command would outlive the viewer.
 */
export function watchdog(command: string): string {
  return `${command} &
P=$!
trap 'kill $P 2>/dev/null' EXIT
cat >/dev/null
`;
}

/** The wrapper a streamed command runs in, as one shell command line. */
export function streamCommand(script: string, sudo: boolean): string {
  const inner = `${SBIN}${script}`;
  const quoted = `'${inner.replace(/'/g, `'\\''`)}'`;
  return sudo
    ? `if [ "$(id -u)" = "0" ]; then exec bash -c ${quoted}; elif sudo -n true 2>/dev/null; then exec ${SUDO} bash -c ${quoted}; else exec bash -c ${quoted}; fi`
    : `exec bash -c ${quoted}`;
}
