import { useCallback, useEffect, useState } from "react";
import { ServerCog } from "lucide-react";
import {
  useHosts,
  usePermission,
  useTabs,
  useTranslation,
  type DashboardCardProps,
} from "@termix-ssh/plugin-sdk/frontend";
import { ListBadge, ListRow, PanelList } from "@termix-ssh/plugin-sdk/ui";
import type { WatchView } from "../shared/types";
import { errorMessage, listAllWatches } from "./api";
import { stateTone } from "./format";

const POLL_MS = 30_000;

/** Dashboard card: every watched service with the last state seen. */
export function WatchesCard({ isVisible }: DashboardCardProps) {
  const { t } = useTranslation();
  const allowed = usePermission("use");
  const tabs = useTabs();
  const { hosts } = useHosts();
  const [watches, setWatches] = useState<Array<
    WatchView & { hostId: number }
  > | null>(null);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    try {
      setWatches(await listAllWatches());
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("units.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    if (!isVisible || !allowed) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [isVisible, allowed, load]);

  if (failed) return <p className="p-3 text-xs text-destructive">{failed}</p>;
  if (!watches) {
    return (
      <p className="p-3 text-xs text-muted-foreground">{t("tab.loading")}</p>
    );
  }

  const down = (state: string) => state === "failed" || state === "inactive";
  const sorted = [...watches].sort(
    (a, b) => Number(down(b.state)) - Number(down(a.state)),
  );

  return (
    <PanelList
      empty={
        <p className="p-3 text-xs text-muted-foreground">{t("card.empty")}</p>
      }
    >
      {sorted.map((watch, index) => {
        const host = hosts.find((h) => Number(h.id) === watch.hostId);
        return (
          <ListRow
            key={`${watch.hostId}:${watch.unit}`}
            stripe={index}
            tone={watch.state ? stateTone(watch.state) : "muted"}
            icon={<ServerCog className="size-3.5" />}
            title={<span className="font-mono text-xs">{watch.unit}</span>}
            meta={host?.name || host?.ip || `#${watch.hostId}`}
            badges={
              <ListBadge
                tone={
                  down(watch.state)
                    ? "destructive"
                    : watch.state === "active"
                      ? "success"
                      : "muted"
                }
              >
                {watch.state || t("card.unknown")}
              </ListBadge>
            }
            onClick={() => host && tabs.openTab(host, "service-manager")}
          />
        );
      })}
    </PanelList>
  );
}
