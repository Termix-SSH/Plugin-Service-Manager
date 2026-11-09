import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ScrollText, ServerCog, Timer } from "lucide-react";
import {
  useHosts,
  useTabs,
  useTranslation,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import { ManagerCardShell, Segmented } from "@termix-ssh/plugin-sdk/ui";
import type { ServicesStatus } from "../shared/types";
import { errorMessage, getStatus } from "./api";
import { servicesEnabled } from "./enabled";
import { JournalView } from "./JournalView";
import { LogFilesView } from "./LogFilesView";
import { ServicesCompanion } from "./ServicesCompanion";
import { TimersView } from "./TimersView";

type CardProps = { hostId: number | null };
type LogView = "journal" | "files";

/** The frame of a Host Metrics card: host lookup, status and refresh. */
function ManagerCard({
  hostId,
  titleKey,
  icon,
  children,
}: CardProps & {
  titleKey: string;
  icon: ReactNode;
  children: (host: PluginHostRecord, status: ServicesStatus) => ReactNode;
}) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const host = hosts.find((h) => Number(h.id) === hostId);
  const on = !!host && servicesEnabled(host);
  const [status, setStatus] = useState<ServicesStatus | null>(null);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!on || hostId == null) return;
    setLoading(true);
    try {
      setStatus(await getStatus(hostId));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("tab.error")));
    } finally {
      setLoading(false);
    }
  }, [on, hostId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!host) return null;
  return (
    <ManagerCardShell
      title={t(titleKey)}
      icon={icon}
      loading={loading}
      error={failed ? { message: failed } : null}
      onRefresh={() => {
        void load();
        setTick((n) => n + 1);
      }}
      empty={!on}
      emptyMessage={t("manager.disabled")}
    >
      {status && (
        <Fragment key={tick}>
          {children(host as PluginHostRecord, status)}
        </Fragment>
      )}
    </ManagerCardShell>
  );
}

export function ServicesCard({ hostId }: CardProps) {
  return (
    <ManagerCard
      hostId={hostId}
      titleKey="manager.services"
      icon={<ServerCog className="size-3.5" />}
    >
      {(host) => (
        <ServicesCompanion host={host as never} isVisible showRefresh={false} />
      )}
    </ManagerCard>
  );
}

function TimersBody({
  host,
  status,
}: {
  host: PluginHostRecord;
  status: ServicesStatus;
}) {
  const { t } = useTranslation();
  const tabs = useTabs();
  if (status.init !== "systemd") {
    return (
      <p className="p-2 text-xs text-muted-foreground">
        {t("manager.needsSystemd")}
      </p>
    );
  }
  return (
    <TimersView
      hostId={Number(host.id)}
      canEdit={status.canEdit}
      isVisible
      onOpen={() => tabs.openTab(host as never, "service-manager")}
    />
  );
}

export function TimersCard({ hostId }: CardProps) {
  return (
    <ManagerCard
      hostId={hostId}
      titleKey="manager.timers"
      icon={<Timer className="size-3.5" />}
    >
      {(host, status) => <TimersBody host={host} status={status} />}
    </ManagerCard>
  );
}

function LogsBody({
  host,
  status,
}: {
  host: PluginHostRecord;
  status: ServicesStatus;
}) {
  const { t } = useTranslation();
  const hostId = Number(host.id);
  const journal = status.init === "systemd" && status.journal;
  const [view, setView] = useState<LogView>("journal");

  if (!journal || view === "files") {
    return (
      <div className="flex min-h-0 flex-col gap-2">
        {journal && (
          <Segmented<LogView>
            value={view}
            onChange={setView}
            options={logViews(t)}
          />
        )}
        <LogFilesView
          hostId={hostId}
          host={host}
          roots={status.logRoots}
          isVisible
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Segmented<LogView>
        value={view}
        onChange={setView}
        options={logViews(t)}
      />
      <JournalView
        hostId={hostId}
        host={host}
        canEdit={status.canEdit}
        isVisible
      />
    </div>
  );
}

function logViews(t: (key: string) => string) {
  return [
    { value: "journal" as const, label: t("tab.viewJournal") },
    { value: "files" as const, label: t("tab.viewFiles") },
  ];
}

export function LogsCard({ hostId }: CardProps) {
  return (
    <ManagerCard
      hostId={hostId}
      titleKey="manager.logs"
      icon={<ScrollText className="size-3.5" />}
    >
      {(host, status) => <LogsBody host={host} status={status} />}
    </ManagerCard>
  );
}
