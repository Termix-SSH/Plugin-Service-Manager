import type {
  BootView,
  EditTarget,
  InitSystem,
  JournalResult,
  LogFileView,
  LogTail,
  NewServiceInput,
  TimerView,
  UnitAction,
  UnitDetail,
  UnitFileView,
  UnitSummary,
  VerifyResult,
} from "../shared/types.js";
import { OPENRC_ACTIONS } from "../shared/types.js";
import { ServicesError } from "./errors.js";
import type { HostSettings } from "./host-settings.js";
import {
  BOOTS_SCRIPT,
  MAX_LINES,
  USAGE_SCRIPT,
  journalScript,
  parseBoots,
  parseJournal,
  parseUsage,
  vacuumScript,
  type JournalQuery,
} from "./journal.js";
import {
  downloadScript,
  listScript,
  parseFileList,
  tailScript,
} from "./logfiles.js";
import { isWritableUnitName } from "./names.js";
import {
  OPENRC_LIST_SCRIPT,
  openRcActionScript,
  openRcStatusScript,
  parseOpenRcList,
} from "./openrc.js";
import { type Remote } from "./remote.js";
import {
  DETECT_SCRIPT,
  parseDetect,
  type Detected,
} from "@termix-ssh/plugin-sdk/host-scripts";

export { DETECT_SCRIPT, parseDetect, type Detected };
import {
  TIMERS_SCRIPT,
  actionScript,
  detailScript,
  listUnitsScript,
  parseDetail,
  parseTimers,
  parseUnitList,
  type ListType,
} from "./systemd.js";
import {
  afterCreateScript,
  calendarScript,
  deleteScript,
  parseFileView,
  parseVerify,
  readFileScript,
  saveScript,
  serviceText,
  timerText,
  verifyScript,
} from "./unit-files.js";

/** Everything the routes do on a host, for one host's settings. */
export function createManager(remote: Remote) {
  // The init system rarely changes, so it is kept for a few minutes.
  const initCache = new Map<number, { init: InitSystem; at: number }>();

  async function detect(hostId: number, s: HostSettings): Promise<Detected> {
    const { stdout } = await remote.read(hostId, s.sudo, DETECT_SCRIPT);
    const found = parseDetect(stdout);
    initCache.set(hostId, { init: found.init, at: Date.now() });
    return found;
  }

  async function initOf(hostId: number, s: HostSettings): Promise<InitSystem> {
    const cached = initCache.get(hostId);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.init;
    return (await detect(hostId, s)).init;
  }

  async function needSystemd(hostId: number, s: HostSettings): Promise<void> {
    const init = await initOf(hostId, s);
    if (init !== "systemd") {
      throw new ServicesError("This needs systemd on the host", 400, {
        code: "systemd",
      });
    }
  }

  return {
    detect,
    initOf,

    async units(
      hostId: number,
      s: HostSettings,
      type: ListType,
    ): Promise<UnitSummary[]> {
      const init = await initOf(hostId, s);
      if (init === "openrc") {
        const { stdout } = await remote.read(
          hostId,
          s.sudo,
          OPENRC_LIST_SCRIPT,
        );
        return parseOpenRcList(stdout);
      }
      if (init !== "systemd") return [];
      const { stdout } = await remote.read(
        hostId,
        s.sudo,
        listUnitsScript(type),
        {
          maxOutputBytes: 4_000_000,
        },
      );
      return parseUnitList(stdout);
    },

    async detail(
      hostId: number,
      s: HostSettings,
      unit: string,
    ): Promise<UnitDetail> {
      const init = await initOf(hostId, s);
      if (init === "openrc") {
        const { stdout } = await remote.read(
          hostId,
          s.sudo,
          openRcStatusScript(unit),
        );
        return { name: unit, props: { Id: unit }, status: stdout.trim() };
      }
      await needSystemd(hostId, s);
      const { stdout } = await remote.read(hostId, s.sudo, detailScript(unit));
      return parseDetail(unit, stdout);
    },

    async action(
      hostId: number,
      s: HostSettings,
      unit: string,
      action: UnitAction,
    ): Promise<{ state: string; output: string }> {
      const init = await initOf(hostId, s);
      if (init === "openrc") {
        if (!OPENRC_ACTIONS.includes(action)) {
          throw new ServicesError("OpenRC can't do that");
        }
        const { stdout } = await remote.root(
          hostId,
          s.sudo,
          openRcActionScript(unit, action),
          {
            timeoutMs: 120_000,
          },
        );
        return { state: "", output: stdout.trim() };
      }
      await needSystemd(hostId, s);
      const { stdout } = await remote.root(
        hostId,
        s.sudo,
        actionScript(unit, action),
        {
          timeoutMs: 120_000,
        },
      );
      const state = /^state=(.*)$/m.exec(stdout)?.[1]?.trim() ?? "";
      return {
        state,
        output: stdout.replace(/^state=.*$/m, "").trim(),
      };
    },

    async readFile(
      hostId: number,
      s: HostSettings,
      unit: string,
    ): Promise<UnitFileView> {
      await needSystemd(hostId, s);
      const { stdout } = await remote.read(
        hostId,
        s.sudo,
        readFileScript(unit),
      );
      return parseFileView(unit, stdout);
    },

    async verify(
      hostId: number,
      s: HostSettings,
      unit: string,
      target: EditTarget,
      text: string,
    ): Promise<VerifyResult> {
      await needSystemd(hostId, s);
      const { stdout } = await remote.read(
        hostId,
        s.sudo,
        verifyScript(unit, target, text),
      );
      return parseVerify(stdout);
    },

    async saveFile(
      hostId: number,
      s: HostSettings,
      unit: string,
      target: EditTarget,
      text: string,
    ): Promise<void> {
      await needSystemd(hostId, s);
      if (!isWritableUnitName(unit)) {
        throw new ServicesError("Files can't be written for this unit");
      }
      await remote.root(hostId, s.sudo, saveScript(unit, target, text));
    },

    async deleteFile(
      hostId: number,
      s: HostSettings,
      unit: string,
    ): Promise<void> {
      await needSystemd(hostId, s);
      await remote.root(hostId, s.sudo, deleteScript(unit));
    },

    async create(
      hostId: number,
      s: HostSettings,
      input: NewServiceInput,
    ): Promise<string[]> {
      await needSystemd(hostId, s);
      const made = [input.name];
      if (input.onCalendar) {
        await remote.read(hostId, s.sudo, calendarScript(input.onCalendar));
      }
      await remote.root(
        hostId,
        s.sudo,
        saveScript(input.name, "unit", serviceText(input), { mustBeNew: true }),
      );
      if (input.onCalendar) {
        const timer = input.name.replace(/\.service$/, ".timer");
        await remote.root(
          hostId,
          s.sudo,
          saveScript(timer, "unit", timerText(input), { mustBeNew: true }),
        );
        made.push(timer);
      }
      if (input.enable || input.start) {
        await remote.root(hostId, s.sudo, afterCreateScript(input), {
          timeoutMs: 120_000,
        });
      }
      return made;
    },

    async timers(hostId: number, s: HostSettings): Promise<TimerView[]> {
      if ((await initOf(hostId, s)) !== "systemd") return [];
      const { stdout } = await remote.read(hostId, s.sudo, TIMERS_SCRIPT, {
        maxOutputBytes: 2_000_000,
      });
      return parseTimers(stdout);
    },

    async journal(
      hostId: number,
      s: HostSettings,
      query: JournalQuery,
    ): Promise<JournalResult> {
      await needSystemd(hostId, s);
      const result = await remote.read(hostId, s.sudo, journalScript(query), {
        maxOutputBytes: 4_000_000,
        timeoutMs: 60_000,
      });
      const entries = parseJournal(result.stdout, query);
      return {
        entries: entries.slice(-Math.min(MAX_LINES, query.lines)),
        truncated: entries.length >= query.lines,
      };
    },

    async boots(hostId: number, s: HostSettings): Promise<BootView[]> {
      await needSystemd(hostId, s);
      const { stdout } = await remote.read(hostId, s.sudo, BOOTS_SCRIPT);
      return parseBoots(stdout);
    },

    async usage(hostId: number, s: HostSettings): Promise<{ size: string }> {
      await needSystemd(hostId, s);
      const { stdout } = await remote.read(hostId, s.sudo, USAGE_SCRIPT);
      return { size: parseUsage(stdout) };
    },

    async vacuum(
      hostId: number,
      s: HostSettings,
      body: Record<string, unknown>,
    ): Promise<{ output: string }> {
      await needSystemd(hostId, s);
      const { stdout } = await remote.root(hostId, s.sudo, vacuumScript(body), {
        timeoutMs: 120_000,
      });
      return { output: stdout.trim() };
    },

    async logFiles(hostId: number, s: HostSettings): Promise<LogFileView[]> {
      const { stdout } = await remote.read(
        hostId,
        s.sudo,
        listScript(s.logRoots),
        {
          maxOutputBytes: 1_000_000,
        },
      );
      return parseFileList(stdout);
    },

    async tail(
      hostId: number,
      s: HostSettings,
      path: string,
      lines: number,
      grep: string,
    ): Promise<LogTail> {
      const { stdout } = await remote.read(
        hostId,
        s.sudo,
        tailScript(path, s.logRoots, lines, grep),
        { maxOutputBytes: 4_000_000, timeoutMs: 60_000 },
      );
      const out = stdout.split("\n");
      if (out[out.length - 1] === "") out.pop();
      return { path, lines: out };
    },

    async download(
      hostId: number,
      s: HostSettings,
      path: string,
    ): Promise<string> {
      const { stdout } = await remote.read(
        hostId,
        s.sudo,
        downloadScript(path, s.logRoots),
        {
          maxOutputBytes: 4_194_304,
          timeoutMs: 120_000,
        },
      );
      return stdout;
    },
  };
}

export type Manager = ReturnType<typeof createManager>;
