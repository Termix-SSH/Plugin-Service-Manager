import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Play, RefreshCw, RotateCw, Square } from "lucide-react";
import {
  useSettings,
  useTabs,
  useToast,
  useTranslation,
  type CompanionDefaults,
  type CompanionProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  PanelSearch,
} from "@termix-ssh/plugin-sdk/ui";
import type { ServicesStatus, UnitAction, UnitSummary } from "../shared/types";
import { errorMessage, getStatus, listUnits, unitAction } from "./api";
import { sortUnits, stateTone } from "./format";
import { UnitLog } from "./UnitDetail";

/** Starting state of the panel, from the user's settings. */
export function useServicesCompanionDefaults(): CompanionDefaults {
  const { values } = useSettings("user");
  const side = values.companionSide;
  return {
    open: values.companionAutoOpen === true,
    side: side === "left" || side === "bottom" ? side : "right",
    size: typeof values.companionSize === "number" ? values.companionSize : 360,
    edgeButton: values.companionEdgeButton !== false,
  };
}

/** A compact services list beside a terminal, with the picked unit's log. */
export function ServicesCompanion({ host, isVisible }: CompanionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const tabs = useTabs();
  const hostId = host ? Number(host.id) : 0;
  const [status, setStatus] = useState<ServicesStatus | null>(null);
  const [units, setUnits] = useState<UnitSummary[] | null>(null);
  const [failed, setFailed] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!hostId) return;
    try {
      const [nextStatus, list] = await Promise.all([
        getStatus(hostId),
        listUnits(hostId, "service"),
      ]);
      setStatus(nextStatus);
      setUnits(list);
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("units.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const run = async (unit: string, action: UnitAction) => {
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

  const openTab = () => {
    if (host) tabs.openTab(host, "service-manager");
  };

  const needle = search.trim().toLowerCase();
  const visible = sortUnits(
    (units ?? []).filter(
      (unit) =>
        unit.load !== "unloaded" &&
        (!needle || unit.name.toLowerCase().includes(needle)),
    ),
  ).slice(0, 300);
  const canEdit = !!status?.canEdit;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-1.5">
      <div className="flex items-center gap-1">
        <PanelSearch
          value={search}
          onChange={setSearch}
          placeholder={t("units.search")}
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void load()}
          title={t("tab.refresh")}
          className="text-accent-brand"
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={openTab}
          title={t("companion.openTab")}
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
      {failed ? (
        <p className="p-2 text-xs text-destructive">{failed}</p>
      ) : !units ? (
        <p className="p-2 text-xs text-muted-foreground">{t("tab.loading")}</p>
      ) : (
        <PanelList className={picked ? "max-h-[45%]" : ""}>
          {visible.map((unit, index) => {
            const running = unit.active === "active";
            return (
              <ListRow
                key={unit.name}
                stripe={index}
                tone={stateTone(unit.active)}
                selected={picked === unit.name}
                title={<span className="font-mono text-xs">{unit.name}</span>}
                badges={
                  unit.active !== "active" && unit.active !== "inactive" ? (
                    <ListBadge tone={stateTone(unit.active)}>
                      {unit.active}
                    </ListBadge>
                  ) : undefined
                }
                onClick={() =>
                  setPicked((prev) => (prev === unit.name ? "" : unit.name))
                }
                actions={
                  canEdit ? (
                    running ? (
                      <>
                        <ListRowAction
                          label={t("actions.restart")}
                          disabled={busy === unit.name}
                          onClick={() => void run(unit.name, "restart")}
                        >
                          <RotateCw className="size-4" />
                        </ListRowAction>
                        <ListRowAction
                          label={t("actions.stop")}
                          tone="destructive"
                          disabled={busy === unit.name}
                          onClick={() => void run(unit.name, "stop")}
                        >
                          <Square className="size-4" />
                        </ListRowAction>
                      </>
                    ) : (
                      <ListRowAction
                        label={t("actions.start")}
                        tone="brand"
                        disabled={busy === unit.name}
                        onClick={() => void run(unit.name, "start")}
                      >
                        <Play className="size-4" />
                      </ListRowAction>
                    )
                  ) : undefined
                }
              />
            );
          })}
        </PanelList>
      )}
      {picked && status?.init === "systemd" && status.journal && (
        <div className="min-h-0 flex-1">
          <UnitLog
            key={picked}
            hostId={hostId}
            host={host}
            unit={picked}
            isVisible={isVisible}
            className="h-full max-h-none"
          />
        </div>
      )}
    </div>
  );
}
