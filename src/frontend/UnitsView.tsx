import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Play, RotateCw, Square } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  PanelSearch,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { ServicesStatus, UnitAction, UnitSummary } from "../shared/types";
import {
  errorMessage,
  listUnits,
  listWatches,
  setWatch,
  unitAction,
} from "./api";
import { sortUnits, stateTone } from "./format";

type Filter = "all" | "running" | "failed" | "stopped" | "enabled";
type UnitType = "service" | "socket" | "timer" | "target" | "path" | "mount";

const TYPES: UnitType[] = [
  "service",
  "socket",
  "timer",
  "target",
  "path",
  "mount",
];

export function matchesFilter(unit: UnitSummary, filter: Filter): boolean {
  switch (filter) {
    case "running":
      return unit.active === "active" || unit.active === "reloading";
    case "failed":
      return unit.active === "failed";
    case "stopped":
      return unit.active === "inactive";
    case "enabled":
      return unit.fileState.startsWith("enabled");
    default:
      return true;
  }
}

export function UnitsView({
  hostId,
  status,
  onOpen,
  isVisible,
}: {
  hostId: number;
  status: ServicesStatus;
  onOpen: (unit: string) => void;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const systemd = status.init === "systemd";
  const [type, setType] = useState<UnitType>("service");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [units, setUnits] = useState<UnitSummary[] | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, watches] = await Promise.all([
        listUnits(hostId, systemd ? type : "service"),
        systemd ? listWatches(hostId).catch(() => []) : Promise.resolve([]),
      ]);
      setUnits(list);
      setWatched(new Set(watches.map((w) => w.unit)));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("units.loadFailed")));
    }
  }, [hostId, systemd, type, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: 0,
      running: 0,
      failed: 0,
      stopped: 0,
      enabled: 0,
    };
    for (const unit of units ?? []) {
      for (const key of Object.keys(out) as Filter[]) {
        if (matchesFilter(unit, key)) out[key]++;
      }
    }
    return out;
  }, [units]);

  const run = async (unit: string, action: UnitAction) => {
    if (action === "stop") {
      const ok = await confirm({
        title: t("units.confirmStop", { unit }),
        description: t("units.confirmStopDesc"),
        confirmLabel: t("actions.stop"),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(unit);
    try {
      await unitAction(hostId, unit, action);
      toast.success(t(`actions.done.${action}`, { unit }));
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("actions.failed")));
    } finally {
      setBusy("");
    }
  };

  const toggleWatch = async (unit: string) => {
    const on = !watched.has(unit);
    try {
      await setWatch(hostId, unit, on);
      setWatched((prev) => {
        const next = new Set(prev);
        if (on) next.add(unit);
        else next.delete(unit);
        return next;
      });
      toast.success(on ? t("watch.on", { unit }) : t("watch.off", { unit }));
    } catch (e) {
      toast.error(errorMessage(e, t("watch.failed")));
    }
  };

  const needle = search.trim().toLowerCase();
  const visible = sortUnits(
    (units ?? []).filter(
      (unit) =>
        matchesFilter(unit, filter) &&
        (!needle ||
          unit.name.toLowerCase().includes(needle) ||
          unit.description.toLowerCase().includes(needle)),
    ),
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <PanelSearch
          value={search}
          onChange={setSearch}
          placeholder={t("units.search")}
          className="min-w-48 flex-1"
        />
        {systemd && (
          <Select value={type} onValueChange={(v) => setType(v as UnitType)}>
            <SelectTrigger
              size="sm"
              className="w-36"
              aria-label={t("units.type")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`units.types.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={(
          ["all", "running", "failed", "stopped", "enabled"] as Filter[]
        ).map((value) => ({
          value,
          label: t(`units.filters.${value}`),
          count: units ? counts[value] : undefined,
        }))}
      />
      {failed ? (
        <p className="p-2 text-sm text-destructive">{failed}</p>
      ) : !units ? (
        <p className="p-2 text-xs text-muted-foreground">{t("tab.loading")}</p>
      ) : visible.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground/60">
          {t("units.empty")}
        </p>
      ) : (
        <PanelList>
          {visible.map((unit, index) => {
            const running =
              unit.active === "active" || unit.active === "reloading";
            const canRun =
              status.canEdit && (unit.type === "service" || !systemd);
            return (
              <ListRow
                key={unit.name}
                stripe={index}
                tone={stateTone(unit.active)}
                title={<span className="font-mono">{unit.name}</span>}
                meta={unit.description || undefined}
                dimmed={unit.load === "masked" || unit.load === "not-found"}
                badges={
                  <>
                    <ListBadge tone={stateTone(unit.active)}>
                      {unit.sub && unit.sub !== unit.active
                        ? `${unit.active} | ${unit.sub}`
                        : unit.active}
                    </ListBadge>
                    {unit.fileState && (
                      <ListBadge
                        tone={
                          unit.fileState.startsWith("enabled")
                            ? "brand"
                            : "muted"
                        }
                      >
                        {unit.fileState}
                      </ListBadge>
                    )}
                    {watched.has(unit.name) && (
                      <ListBadge tone="warning">
                        <Bell />
                        {t("watch.badge")}
                      </ListBadge>
                    )}
                  </>
                }
                onClick={() => onOpen(unit.name)}
                actions={
                  <>
                    {canRun && !running && (
                      <ListRowAction
                        label={t("actions.start")}
                        tone="brand"
                        disabled={busy === unit.name}
                        onClick={() => void run(unit.name, "start")}
                      >
                        <Play className="size-4" />
                      </ListRowAction>
                    )}
                    {canRun && running && (
                      <ListRowAction
                        label={t("actions.restart")}
                        disabled={busy === unit.name}
                        onClick={() => void run(unit.name, "restart")}
                      >
                        <RotateCw className="size-4" />
                      </ListRowAction>
                    )}
                    {canRun && running && (
                      <ListRowAction
                        label={t("actions.stop")}
                        tone="destructive"
                        disabled={busy === unit.name}
                        onClick={() => void run(unit.name, "stop")}
                      >
                        <Square className="size-4" />
                      </ListRowAction>
                    )}
                    {systemd && (
                      <ListRowAction
                        label={
                          watched.has(unit.name)
                            ? t("watch.stop")
                            : t("watch.start")
                        }
                        onClick={() => void toggleWatch(unit.name)}
                      >
                        {watched.has(unit.name) ? (
                          <BellOff className="size-4" />
                        ) : (
                          <Bell className="size-4" />
                        )}
                      </ListRowAction>
                    )}
                  </>
                }
              />
            );
          })}
        </PanelList>
      )}
    </div>
  );
}
