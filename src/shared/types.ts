import type {
  InitSystem,
  JournalEntry,
  UnitAction,
} from "@termix-ssh/plugin-sdk/host-scripts";

export {
  OPENRC_ACTIONS,
  UNIT_ACTIONS,
} from "@termix-ssh/plugin-sdk/host-scripts";
export type {
  BootView,
  InitSystem,
  JournalEntry,
  TimerView,
  UnitAction,
  UnitDetail,
  UnitSummary,
} from "@termix-ssh/plugin-sdk/host-scripts";

export interface ServicesStatus {
  init: InitSystem;
  version: string;
  os: string;
  hostname: string;
  /** Changes can run as root on this host. */
  root: boolean;
  journal: boolean;
  failed: number;
  /** The caller has edit access and the host is not read only. */
  canEdit: boolean;
  readOnly: boolean;
  logRoots: string[];
}

export interface UnitFileView {
  name: string;
  /** systemctl cat: the unit with every drop-in. */
  combined: string;
  fragmentPath: string;
  fragment: string;
  dropIns: string[];
  override: string;
  overridePath: string;
  /** The unit file lives in /etc/systemd/system and can be deleted. */
  local: boolean;
  /** A file can be written for this unit name. */
  writable: boolean;
}

export type EditTarget = "unit" | "override";

export interface VerifyResult {
  ok: boolean;
  output: string;
}

export interface JournalResult {
  entries: JournalEntry[];
  truncated: boolean;
}

export interface LogFileView {
  path: string;
  size: number;
  /** Unix ms. */
  modified: number;
  compressed: boolean;
}

export interface LogTail {
  path: string;
  lines: string[];
}

export interface NewServiceInput {
  name: string;
  description: string;
  execStart: string;
  type: "simple" | "exec" | "forking" | "oneshot" | "notify";
  user: string;
  group: string;
  workingDirectory: string;
  environment: string[];
  restart: "no" | "on-failure" | "always" | "on-abnormal";
  restartSec: number;
  after: string;
  wantedBy: string;
  enable: boolean;
  start: boolean;
  /** Also make a timer that starts the service on this OnCalendar value. */
  onCalendar: string;
}

export interface WatchView {
  unit: string;
  /** The last state the checker saw, or empty before the first check. */
  state: string;
}

/** Follow socket messages from the browser. */
export interface FollowConnect {
  hostConfig: { id: number; syncId?: string | null; ip?: string };
  source: "journal" | "file";
  units?: string[];
  priority?: number;
  grep?: string;
  path?: string;
  lines?: number;
}
