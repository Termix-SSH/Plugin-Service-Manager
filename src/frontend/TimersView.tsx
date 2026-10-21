import { useCallback, useEffect, useState } from "react";
import { Play, Power, PowerOff, Timer } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  PanelSearch,
} from "@termix-ssh/plugin-sdk/ui";
import type { TimerView } from "../shared/types";
import { errorMessage, listTimers, unitAction } from "./api";
import { dateTime, span, stateTone } from "./format";

export function TimersView({
  hostId,
  canEdit,
  isVisible,
  onOpen,
}: {
  hostId: number;
  canEdit: boolean;
  isVisible: boolean;
  onOpen: (unit: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [timers, setTimers] = useState<TimerView[] | null>(null);
  const [failed, setFailed] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setTimers(await listTimers(hostId));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("timers.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const run = async (
    unit: string,
    action: "start" | "enable-now" | "disable-now",
    done: string,
  ) => {
    try {
      await unitAction(hostId, unit, action);
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("actions.failed")));
    }
  };

  if (failed) return <p className="p-2 text-sm text-destructive">{failed}</p>;
  if (!timers) {
    return (
      <p className="p-2 text-xs text-muted-foreground">{t("tab.loading")}</p>
    );
  }

  const now = Date.now();
  const needle = search.trim().toLowerCase();
  const visible = timers.filter(
    (timer) =>
      !needle ||
      timer.name.toLowerCase().includes(needle) ||
      timer.activates.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-2">
      <PanelSearch
        value={search}
        onChange={setSearch}
        placeholder={t("timers.search")}
      />
      {visible.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground/60">
          {t("timers.empty")}
        </p>
      ) : (
        <PanelList>
          {visible.map((timer, index) => {
            const on = timer.active === "active";
            const meta = [
              timer.next
                ? t("timers.next", {
                    when: dateTime(timer.next),
                    left: span(timer.next - now),
                  })
                : t("timers.noNext"),
              timer.last
                ? t("timers.last", {
                    when: dateTime(timer.last),
                    ago: span(now - timer.last),
                  })
                : t("timers.neverRan"),
            ].join(" | ");
            return (
              <ListRow
                key={timer.name}
                stripe={index}
                tone={stateTone(timer.active)}
                icon={<Timer className="size-4" />}
                title={<span className="font-mono">{timer.name}</span>}
                meta={meta}
                onClick={() => onOpen(timer.name)}
                badges={
                  <>
                    <ListBadge tone={stateTone(timer.active)}>
                      {timer.active}
                    </ListBadge>
                    {timer.activates && (
                      <ListBadge tone="muted">{timer.activates}</ListBadge>
                    )}
                    {timer.schedule.slice(0, 2).map((s) => (
                      <ListBadge key={s} tone="muted">
                        <span className="normal-case">{s}</span>
                      </ListBadge>
                    ))}
                  </>
                }
                actions={
                  canEdit ? (
                    <>
                      {timer.activates && (
                        <ListRowAction
                          label={t("timers.runNow")}
                          tone="brand"
                          onClick={() =>
                            void run(
                              timer.activates,
                              "start",
                              t("timers.ran", { unit: timer.activates }),
                            )
                          }
                        >
                          <Play className="size-4" />
                        </ListRowAction>
                      )}
                      {on ? (
                        <ListRowAction
                          label={t("timers.turnOff")}
                          tone="destructive"
                          onClick={() =>
                            void run(
                              timer.name,
                              "disable-now",
                              t("actions.done.disable", { unit: timer.name }),
                            )
                          }
                        >
                          <PowerOff className="size-4" />
                        </ListRowAction>
                      ) : (
                        <ListRowAction
                          label={t("timers.turnOn")}
                          onClick={() =>
                            void run(
                              timer.name,
                              "enable-now",
                              t("actions.done.enable", { unit: timer.name }),
                            )
                          }
                        >
                          <Power className="size-4" />
                        </ListRowAction>
                      )}
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </PanelList>
      )}
    </div>
  );
}
