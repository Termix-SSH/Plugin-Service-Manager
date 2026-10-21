export type InitSystem = "systemd" | "openrc" | "none";

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

export interface UnitSummary {
  name: string;
  type: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  /** enabled, disabled, static, masked and so on. Empty when unknown. */
  fileState: string;
  preset: string;
}

export interface UnitDetail {
  name: string;
  props: Record<string, string>;
  status: string;
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

export interface TimerView {
  name: string;
  description: string;
  active: string;
  fileState: string;
  /** Unix ms, or null when not set. */
  next: number | null;
  last: number | null;
  activates: string;
  schedule: string[];
}

export interface JournalEntry {
  /** Unix ms. */
  time: number;
  priority: number;
  unit: string;
  ident: string;
  pid: string;
  message: string;
}

export interface JournalResult {
  entries: JournalEntry[];
  truncated: boolean;
}

export interface BootView {
  offset: number;
  id: string;
  first: string;
  last: string;
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

export const UNIT_ACTIONS = [
  "start",
  "stop",
  "restart",
  "reload",
  "enable",
  "disable",
  "enable-now",
  "disable-now",
  "mask",
  "unmask",
  "reset-failed",
  "revert",
] as const;
export type UnitAction = (typeof UNIT_ACTIONS)[number];

/** Actions OpenRC can do. */
export const OPENRC_ACTIONS: readonly UnitAction[] = [
  "start",
  "stop",
  "restart",
  "enable",
  "disable",
];

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
