import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import type {
  BootView,
  EditTarget,
  JournalResult,
  LogFileView,
  LogTail,
  NewServiceInput,
  ServicesStatus,
  TimerView,
  UnitAction,
  UnitDetail,
  UnitFileView,
  UnitSummary,
  VerifyResult,
  WatchView,
} from "../shared/types";

let client: TermixApp["api"] | null = null;

export function initApi(api: TermixApp["api"]): void {
  client = api;
}

function api(): TermixApp["api"] {
  if (!client) throw new Error("Services is not ready");
  return client;
}

/** The server's message for a failed call, or the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

export function errorCode(error: unknown): string {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response
    ?.data?.code;
  return typeof code === "string" ? code : "";
}

const enc = encodeURIComponent;

export async function getStatus(host: number): Promise<ServicesStatus> {
  return (await api().get<ServicesStatus>(`/${host}/status`)).data;
}

export async function listUnits(
  host: number,
  type: string,
): Promise<UnitSummary[]> {
  return (await api().get<UnitSummary[]>(`/${host}/units?type=${enc(type)}`))
    .data;
}

export async function getUnit(host: number, unit: string): Promise<UnitDetail> {
  return (await api().get<UnitDetail>(`/${host}/units/${enc(unit)}`)).data;
}

export async function unitAction(
  host: number,
  unit: string,
  action: UnitAction,
): Promise<{ state: string; output: string }> {
  return (
    await api().post<{ state: string; output: string }>(
      `/${host}/units/${enc(unit)}/actions/${action}`,
    )
  ).data;
}

export async function getUnitFile(
  host: number,
  unit: string,
): Promise<UnitFileView> {
  return (await api().get<UnitFileView>(`/${host}/units/${enc(unit)}/file`))
    .data;
}

export async function verifyUnitFile(
  host: number,
  unit: string,
  target: EditTarget,
  text: string,
): Promise<VerifyResult> {
  return (
    await api().post<VerifyResult>(`/${host}/units/${enc(unit)}/file/verify`, {
      target,
      text,
    })
  ).data;
}

export async function saveUnitFile(
  host: number,
  unit: string,
  target: EditTarget,
  text: string,
): Promise<void> {
  await api().put(`/${host}/units/${enc(unit)}/file`, { target, text });
}

export async function deleteUnit(host: number, unit: string): Promise<void> {
  await api().delete(`/${host}/units/${enc(unit)}/file`);
}

export async function createService(
  host: number,
  input: NewServiceInput,
): Promise<{ units: string[] }> {
  return (await api().post<{ units: string[] }>(`/${host}/units`, input)).data;
}

export async function listTimers(host: number): Promise<TimerView[]> {
  return (await api().get<TimerView[]>(`/${host}/timers`)).data;
}

export interface JournalFilters {
  units: string[];
  priority: string;
  since: string;
  boot: string;
  grep: string;
  lines: number;
  kernel: boolean;
}

export function journalParams(filters: JournalFilters): string {
  const params = new URLSearchParams();
  for (const unit of filters.units) params.append("unit", unit);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.since) params.set("since", filters.since);
  if (filters.boot) params.set("boot", filters.boot);
  if (filters.grep) params.set("grep", filters.grep);
  if (filters.kernel) params.set("kernel", "true");
  params.set("lines", String(filters.lines));
  return params.toString();
}

export async function readJournal(
  host: number,
  filters: JournalFilters,
): Promise<JournalResult> {
  return (
    await api().get<JournalResult>(`/${host}/journal?${journalParams(filters)}`)
  ).data;
}

export async function listBoots(host: number): Promise<BootView[]> {
  return (await api().get<BootView[]>(`/${host}/journal/boots`)).data;
}

export async function journalUsage(host: number): Promise<{ size: string }> {
  return (await api().get<{ size: string }>(`/${host}/journal/usage`)).data;
}

export async function vacuumJournal(
  host: number,
  body: { size?: string; time?: string },
): Promise<{ output: string }> {
  return (await api().post<{ output: string }>(`/${host}/journal/vacuum`, body))
    .data;
}

export async function listLogFiles(host: number): Promise<LogFileView[]> {
  return (await api().get<LogFileView[]>(`/${host}/logs`)).data;
}

export async function readLogFile(
  host: number,
  path: string,
  lines: number,
  grep: string,
): Promise<LogTail> {
  const params = new URLSearchParams({ path, lines: String(lines) });
  if (grep) params.set("grep", grep);
  return (await api().get<LogTail>(`/${host}/logs/file?${params}`)).data;
}

export async function downloadLogFile(
  host: number,
  path: string,
): Promise<string> {
  const params = new URLSearchParams({ path });
  return (
    await api().get<string>(`/${host}/logs/download?${params}`, {
      responseType: "text",
    } as never)
  ).data;
}

/** Every unit the user watches, on every host. */
export async function listAllWatches(): Promise<
  Array<WatchView & { hostId: number }>
> {
  return (await api().get<Array<WatchView & { hostId: number }>>("/watches"))
    .data;
}

export async function listWatches(host: number): Promise<WatchView[]> {
  return (await api().get<WatchView[]>(`/${host}/watches`)).data;
}

export async function setWatch(
  host: number,
  unit: string,
  on: boolean,
): Promise<void> {
  if (on) await api().post(`/${host}/watches`, { unit });
  else await api().delete(`/${host}/watches/${enc(unit)}`);
}

/** Saves text as a file in the browser. */
export function saveText(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
