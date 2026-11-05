import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ServerCog } from "lucide-react";
import { useTranslation, type TabProps } from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  Alert,
  AlertDescription,
  Button,
  PanelShell,
  EmptyState,
  PanelFrame,
  TabStrip,
} from "@termix-ssh/plugin-sdk/ui";
import type { ServicesStatus } from "../shared/types";
import { errorCode, errorMessage, getStatus } from "./api";
import { JournalView } from "./JournalView";
import { LogFilesView } from "./LogFilesView";
import { NewServiceForm } from "./NewServiceForm";
import { TimersView } from "./TimersView";
import { UnitDetail } from "./UnitDetail";
import { UnitEditor } from "./UnitEditor";
import { UnitsView } from "./UnitsView";

type View = "units" | "timers" | "journal" | "files";
type Screen =
  | { kind: "list" }
  | { kind: "unit"; unit: string }
  | { kind: "edit"; unit: string }
  | { kind: "new" };

// A fixed height box, so the panel body inside it can scroll.
/** Services, timers, the journal and log files for one host. */
export function ServicesTab({ isVisible, host, label }: TabProps) {
  const { t } = useTranslation();
  const hostId = Number(host?.id);
  const [status, setStatus] = useState<ServicesStatus | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("units");
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!hostId) return;
    setLoading(true);
    try {
      setStatus(await getStatus(hostId));
      setError("");
    } catch (e) {
      const code = errorCode(e);
      setError(
        code === "sudo"
          ? t("tab.sudo")
          : code === "disabled"
            ? t("tab.disabled")
            : errorMessage(e, t("tab.error")),
      );
    } finally {
      setLoading(false);
    }
  }, [hostId, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  if (!host) {
    return <EmptyState title={t("tab.noHost")} />;
  }

  const title = label || host.name || t("tab.title");
  const icon = <ServerCog className="size-4" />;

  if (!status) {
    return (
      <PanelFrame>
        <PanelShell icon={icon} title={title}>
          {error ? (
            <p className="p-2 text-sm text-destructive">{error}</p>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              {t("tab.loading")}
            </p>
          )}
        </PanelShell>
      </PanelFrame>
    );
  }

  const back = () => {
    setScreen({ kind: "list" });
    setTick((n) => n + 1);
    void load();
  };

  if (screen.kind === "unit") {
    return (
      <PanelFrame>
        <UnitDetail
          key={screen.unit}
          hostId={hostId}
          host={host}
          unit={screen.unit}
          status={status}
          isVisible={isVisible}
          onBack={back}
          onEdit={() => setScreen({ kind: "edit", unit: screen.unit })}
        />
      </PanelFrame>
    );
  }
  if (screen.kind === "edit") {
    return (
      <PanelFrame>
        <UnitEditor
          key={screen.unit}
          hostId={hostId}
          unit={screen.unit}
          canEdit={status.canEdit}
          onClose={() => setScreen({ kind: "unit", unit: screen.unit })}
          onDeleted={back}
        />
      </PanelFrame>
    );
  }
  if (screen.kind === "new") {
    return (
      <PanelFrame>
        <NewServiceForm
          hostId={hostId}
          onClose={back}
          onCreated={(unit) => setScreen({ kind: "unit", unit })}
        />
      </PanelFrame>
    );
  }

  const systemd = status.init === "systemd";
  const views: Array<{ value: View; label: string }> = [
    { value: "units", label: t("tab.viewServices") },
    ...(systemd
      ? [
          { value: "timers" as View, label: t("tab.viewTimers") },
          ...(status.journal
            ? [{ value: "journal" as View, label: t("tab.viewJournal") }]
            : []),
        ]
      : []),
    { value: "files", label: t("tab.viewFiles") },
  ];
  const current = views.some((v) => v.value === view) ? view : "units";

  const statusLine = [
    status.init === "none"
      ? t("tab.noInit")
      : `${status.init} ${status.version}`.trim(),
    status.os,
    status.failed ? t("tab.failedCount", { count: status.failed }) : "",
    status.readOnly ? t("tab.readOnly") : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <PanelFrame>
      <PanelShell
        icon={icon}
        title={title}
        status={statusLine}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                void load();
                setTick((n) => n + 1);
              }}
              disabled={loading}
              title={t("tab.refresh")}
              className="text-accent-brand"
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
            {systemd && status.canEdit && current === "units" && (
              <AddButton
                label={t("create.add")}
                onClick={() => setScreen({ kind: "new" })}
              />
            )}
          </>
        }
        tabs={
          <TabStrip
            tabs={views.map((o) => ({ id: o.value, label: o.label }))}
            activeTab={current}
            onTabChange={(id) => setView(id as View)}
          />
        }
        scroll
      >
        <div
          className={`flex flex-col gap-2 ${current === "units" ? "shrink-0" : "min-h-0"}`}
        >
          {status.canEdit && !status.root && (
            <Alert className="border-x-0 border-t-0">
              <AlertDescription className="text-xs">
                {t("tab.sudo")}
              </AlertDescription>
            </Alert>
          )}
          {status.init === "none" && current === "units" ? (
            <p className="p-2 text-sm text-muted-foreground">
              {t("tab.noInitHint")}
            </p>
          ) : current === "units" ? (
            <UnitsView
              key={tick}
              hostId={hostId}
              status={status}
              isVisible={isVisible}
              onOpen={(unit) => setScreen({ kind: "unit", unit })}
            />
          ) : current === "timers" ? (
            <TimersView
              key={tick}
              hostId={hostId}
              canEdit={status.canEdit}
              isVisible={isVisible}
              onOpen={(unit) => setScreen({ kind: "unit", unit })}
            />
          ) : current === "journal" ? (
            <JournalView
              key={tick}
              hostId={hostId}
              host={host}
              canEdit={status.canEdit}
              isVisible={isVisible}
            />
          ) : (
            <LogFilesView
              key={tick}
              hostId={hostId}
              host={host}
              roots={status.logRoots}
              isVisible={isVisible}
            />
          )}
        </div>
      </PanelShell>
    </PanelFrame>
  );
}
