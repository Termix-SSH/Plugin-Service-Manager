import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, FileCode, RefreshCw, ServerCog } from "lucide-react";
import {
  useToast,
  useTranslation,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  ListBadge,
  PanelShell,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type {
  JournalEntry,
  ServicesStatus,
  UnitAction,
  UnitDetail as Detail,
} from "../shared/types";
import { OPENRC_ACTIONS } from "../shared/types";
import { errorMessage, getUnit, readJournal, unitAction } from "./api";
import {
  bytes,
  cpu,
  dateTime,
  notSet,
  parseUtc,
  span,
  stateTone,
} from "./format";
import { LogLines } from "./LogLines";
import { useFollow } from "./useFollow";

const DANGER: UnitAction[] = [
  "stop",
  "disable",
  "disable-now",
  "mask",
  "revert",
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === "" || children === null || children === undefined) {
    return null;
  }
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono">{children}</dd>
    </>
  );
}

/** The last lines of a unit's journal, with a live follow switch. */
export function UnitLog({
  hostId,
  host,
  unit,
  isVisible,
  className,
}: {
  hostId: number;
  host?: PluginHostRecord;
  unit: string;
  isVisible: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [failed, setFailed] = useState("");
  const [follow, setFollow] = useState(false);
  const live = useFollow<JournalEntry>(
    host,
    { source: "journal", units: [unit], lines: 200 },
    follow && isVisible,
  );

  const load = useCallback(async () => {
    try {
      const result = await readJournal(hostId, {
        units: [unit],
        priority: "",
        since: "",
        boot: "",
        grep: "",
        lines: 200,
        kernel: false,
      });
      setEntries(result.entries);
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("journal.loadFailed")));
    }
  }, [hostId, unit, t]);

  useEffect(() => {
    if (isVisible && !follow) void load();
  }, [isVisible, follow, load]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium">{t("detail.log")}</p>
        <Button
          size="sm"
          variant={follow ? "default" : "outline"}
          onClick={() => setFollow((v) => !v)}
        >
          {follow ? t("journal.following") : t("journal.follow")}
        </Button>
        {!follow && (
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            {t("tab.refresh")}
          </Button>
        )}
        {follow && live.state === "connecting" && (
          <span className="text-xs text-muted-foreground">
            {t("journal.connecting")}
          </span>
        )}
      </div>
      {(failed || live.error) && (
        <p className="text-xs text-destructive">{live.error || failed}</p>
      )}
      <LogLines
        entries={follow ? live.lines : (entries ?? [])}
        showUnit={false}
        empty={t("journal.empty")}
        className={className ?? "max-h-[45vh]"}
      />
    </div>
  );
}

export function UnitDetail({
  hostId,
  host,
  unit,
  status,
  isVisible,
  onBack,
  onEdit,
}: {
  hostId: number;
  host?: PluginHostRecord;
  unit: string;
  status: ServicesStatus;
  isVisible: boolean;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const systemd = status.init === "systemd";

  const load = useCallback(async () => {
    try {
      setDetail(await getUnit(hostId, unit));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("detail.loadFailed")));
    }
  }, [hostId, unit, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const run = async (action: UnitAction) => {
    if (DANGER.includes(action)) {
      const ok = await confirm({
        title: t(`actions.confirm.${action}`, { unit }),
        description: t(`actions.confirmDesc.${action}`),
        confirmLabel: t(`actions.${action}`),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await unitAction(hostId, unit, action);
      toast.success(t(`actions.done.${action}`, { unit }));
    } catch (e) {
      toast.error(errorMessage(e, t("actions.failed")));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const p = detail?.props ?? {};
  const active = p.ActiveState ?? "";
  const running = active === "active" || active === "reloading";
  const fileState = p.UnitFileState ?? "";
  const masked = fileState.startsWith("masked") || p.LoadState === "masked";
  const enabled = fileState.startsWith("enabled");
  const since = parseUtc(p.ActiveEnterTimestamp);
  const dropIns = (p.DropInPaths ?? "").split(/\s+/).filter(Boolean);

  const actions: Array<{ action: UnitAction; show: boolean }> = systemd
    ? [
        { action: "start", show: !running && !masked },
        { action: "stop", show: running },
        { action: "restart", show: !masked && p.CanStart !== "no" },
        { action: "reload", show: running && p.CanReload === "yes" },
        {
          action: "enable",
          show: !enabled && !masked && !!fileState && fileState !== "static",
        },
        { action: "disable", show: enabled },
        { action: "mask", show: !masked },
        { action: "unmask", show: masked },
        { action: "reset-failed", show: active === "failed" },
        { action: "revert", show: dropIns.length > 0 },
      ]
    : OPENRC_ACTIONS.map((action) => ({ action, show: true }));

  return (
    <PanelShell
      icon={<ServerCog className="size-4" />}
      title={<span className="font-mono">{unit}</span>}
      status={
        detail ? (
          <span className="flex items-center gap-1">
            <ListBadge tone={stateTone(active)}>
              {p.SubState ? `${active} | ${p.SubState}` : active || "?"}
            </ListBadge>
            {fileState && (
              <ListBadge tone={enabled ? "brand" : "muted"}>
                {fileState}
              </ListBadge>
            )}
          </span>
        ) : undefined
      }
      leading={
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          title={t("common.back")}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
      }
      actions={
        <>
          {systemd && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <FileCode className="size-4" />
              {t("detail.editFile")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void load()}
            title={t("tab.refresh")}
            className="text-accent-brand"
          >
            <RefreshCw className="size-4" />
          </Button>
        </>
      }
      scroll
      className="gap-2 p-2.5"
    >
      <div className="flex flex-col gap-3">
        {failed && <p className="text-sm text-destructive">{failed}</p>}
        {status.canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {actions
              .filter((a) => a.show)
              .map(({ action }) => (
                <Button
                  key={action}
                  size="sm"
                  variant={
                    DANGER.includes(action)
                      ? "outline"
                      : action === "start" || action === "restart"
                        ? "default"
                        : "outline"
                  }
                  disabled={busy}
                  onClick={() => void run(action)}
                >
                  {t(`actions.${action}`)}
                </Button>
              ))}
          </div>
        )}
        {detail && systemd && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <Row label={t("detail.description")}>{p.Description}</Row>
            <Row label={t("detail.since")}>
              {running && since
                ? `${dateTime(since)} | ${span(Date.now() - since)}`
                : ""}
            </Row>
            <Row label={t("detail.result")}>
              {p.Result && p.Result !== "success" ? p.Result : ""}
            </Row>
            <Row label={t("detail.pid")}>
              {p.MainPID && p.MainPID !== "0" ? p.MainPID : ""}
            </Row>
            <Row label={t("detail.memory")}>
              {notSet(p.MemoryCurrent)
                ? ""
                : `${bytes(p.MemoryCurrent)}${notSet(p.MemoryPeak) ? "" : ` | ${t("detail.peak")} ${bytes(p.MemoryPeak)}`}`}
            </Row>
            <Row label={t("detail.cpu")}>
              {notSet(p.CPUUsageNSec) ? "" : cpu(p.CPUUsageNSec)}
            </Row>
            <Row label={t("detail.tasks")}>
              {notSet(p.TasksCurrent) ? "" : p.TasksCurrent}
            </Row>
            <Row label={t("detail.restarts")}>
              {p.NRestarts && p.NRestarts !== "0" ? p.NRestarts : ""}
            </Row>
            <Row label={t("detail.type")}>{p.Type}</Row>
            <Row label={t("detail.user")}>{p.User}</Row>
            <Row label={t("detail.file")}>{p.FragmentPath}</Row>
            <Row label={t("detail.dropIns")}>{dropIns.join(" ")}</Row>
            <Row label={t("detail.triggeredBy")}>{p.TriggeredBy}</Row>
            <Row label={t("detail.triggers")}>{p.Triggers}</Row>
            <Row label={t("detail.wantedBy")}>{p.WantedBy}</Row>
            <Row label={t("detail.requires")}>{p.Requires}</Row>
            <Row label={t("detail.after")}>{p.After}</Row>
          </dl>
        )}
        {detail?.status && (
          <details className="text-xs" open={!systemd}>
            <summary className="cursor-pointer select-none text-muted-foreground">
              {t("detail.statusText")}
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[11px]">
              {detail.status}
            </pre>
          </details>
        )}
        {systemd && status.journal && (
          <UnitLog
            hostId={hostId}
            host={host}
            unit={unit}
            isVisible={isVisible}
          />
        )}
      </div>
    </PanelShell>
  );
}
