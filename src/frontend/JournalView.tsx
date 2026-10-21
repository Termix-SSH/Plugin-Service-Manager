import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Pause, Play, Radio, RefreshCw } from "lucide-react";
import {
  useToast,
  useTranslation,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { BootView, JournalEntry } from "../shared/types";
import {
  errorMessage,
  journalUsage,
  listBoots,
  readJournal,
  saveText,
  vacuumJournal,
  type JournalFilters,
} from "./api";
import { entryText, PRIORITY_NAMES } from "./format";
import { LogLines } from "./LogLines";
import { useFollow } from "./useFollow";

const ANY = "any";
const SINCE = ["-15min", "-1h", "-6h", "today", "-24h", "-7d"] as const;
const LINES = [100, 300, 1000, 5000] as const;

function Pick({
  value,
  onChange,
  label,
  options,
  className = "w-36",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function JournalView({
  hostId,
  host,
  canEdit,
  isVisible,
}: {
  hostId: number;
  host?: PluginHostRecord;
  canEdit: boolean;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [unitText, setUnitText] = useState("");
  const [grepText, setGrepText] = useState("");
  const [priority, setPriority] = useState(ANY);
  const [since, setSince] = useState<string>("-1h");
  const [boot, setBoot] = useState(ANY);
  const [lines, setLines] = useState("300");
  const [kernel, setKernel] = useState(false);
  const [applied, setApplied] = useState({ units: "", grep: "" });
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(false);
  const [boots, setBoots] = useState<BootView[]>([]);
  const [usage, setUsage] = useState("");
  const [follow, setFollow] = useState(false);

  const units = useMemo(
    () => applied.units.split(/[\s,]+/).filter(Boolean),
    [applied.units],
  );

  const filters: JournalFilters = useMemo(
    () => ({
      units,
      priority: priority === ANY ? "" : priority,
      since: since === ANY ? "" : since,
      boot: boot === ANY ? "" : boot,
      grep: applied.grep,
      lines: Number(lines),
      kernel,
    }),
    [units, priority, since, boot, applied.grep, lines, kernel],
  );

  const live = useFollow<JournalEntry>(
    host,
    {
      source: "journal",
      units,
      priority: priority === ANY ? undefined : Number(priority),
      grep: applied.grep || undefined,
      kernel,
      lines: 100,
    },
    follow && isVisible,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readJournal(hostId, filters);
      setEntries(result.entries);
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("journal.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [hostId, filters, t]);

  useEffect(() => {
    if (isVisible && !follow) void load();
  }, [isVisible, follow, load]);

  useEffect(() => {
    if (!isVisible) return;
    void listBoots(hostId)
      .then(setBoots)
      .catch(() => setBoots([]));
    void journalUsage(hostId)
      .then((u) => setUsage(u.size))
      .catch(() => setUsage(""));
  }, [hostId, isVisible]);

  const apply = () => setApplied({ units: unitText, grep: grepText });

  const shown = follow ? live.lines : (entries ?? []);

  const download = () => {
    saveText(
      `journal-${host?.name || hostId}.log`,
      shown.map(entryText).join("\n") + "\n",
    );
  };

  const vacuum = async () => {
    const ok = await confirm({
      title: t("journal.vacuumTitle"),
      description: t("journal.vacuumDesc"),
      confirmLabel: t("journal.vacuum"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await vacuumJournal(hostId, { time: "4w" });
      const next = await journalUsage(hostId);
      setUsage(next.size);
      toast.success(t("journal.vacuumDone", { size: next.size }));
    } catch (e) {
      toast.error(errorMessage(e, t("journal.vacuumFailed")));
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Input
          value={unitText}
          onChange={(e) => setUnitText(e.target.value)}
          onBlur={apply}
          placeholder={t("journal.unitPlaceholder")}
          aria-label={t("journal.unit")}
          className="h-8 w-56 font-mono text-xs"
        />
        <Input
          value={grepText}
          onChange={(e) => setGrepText(e.target.value)}
          onBlur={apply}
          placeholder={t("journal.searchPlaceholder")}
          aria-label={t("journal.search")}
          className="h-8 w-48 text-xs"
        />
        <Pick
          value={priority}
          onChange={setPriority}
          label={t("journal.priority")}
          options={[
            { value: ANY, label: t("journal.anyPriority") },
            ...PRIORITY_NAMES.slice(0, 7).map((name, i) => ({
              value: String(i),
              label: t("journal.priorityUpTo", { name }),
            })),
          ]}
        />
        <Pick
          value={since}
          onChange={setSince}
          label={t("journal.since")}
          options={[
            ...SINCE.map((value) => ({
              value,
              label: t(`journal.sinceOptions.${value}`),
            })),
            { value: ANY, label: t("journal.sinceOptions.any") },
          ]}
        />
        <Pick
          value={boot}
          onChange={setBoot}
          label={t("journal.boot")}
          className="w-44"
          options={[
            { value: ANY, label: t("journal.anyBoot") },
            ...boots.map((b) => ({
              value: String(b.offset),
              label:
                b.offset === 0
                  ? t("journal.thisBoot")
                  : `${b.offset} | ${b.first}`,
            })),
          ]}
        />
        <Pick
          value={lines}
          onChange={setLines}
          label={t("journal.lines")}
          className="w-28"
          options={LINES.map((n) => ({
            value: String(n),
            label: t("journal.lineCount", { count: n }),
          }))}
        />
        <Button
          type="button"
          size="sm"
          variant={kernel ? "default" : "outline"}
          onClick={() => setKernel((v) => !v)}
        >
          {t("journal.kernel")}
        </Button>
        <button type="submit" hidden />
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={follow ? "default" : "outline"}
          onClick={() => setFollow((v) => !v)}
        >
          <Radio className="size-4" />
          {follow ? t("journal.following") : t("journal.follow")}
        </Button>
        {follow ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => live.setPaused(!live.paused)}
          >
            {live.paused ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {live.paused ? t("journal.resume") : t("journal.pause")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            {t("tab.refresh")}
          </Button>
        )}
        {follow && (
          <Button size="sm" variant="ghost" onClick={live.clear}>
            {t("journal.clear")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!shown.length}
          onClick={download}
        >
          <Download className="size-4" />
          {t("journal.download")}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {[
            t("journal.shown", { count: shown.length }),
            follow && live.state === "connecting"
              ? t("journal.connecting")
              : "",
            follow && live.state === "ended" ? t("journal.ended") : "",
            usage ? t("journal.usage", { size: usage }) : "",
          ]
            .filter(Boolean)
            .join(" | ")}
        </span>
        {canEdit && usage && (
          <Button size="sm" variant="ghost" onClick={() => void vacuum()}>
            {t("journal.vacuum")}
          </Button>
        )}
      </div>
      {(failed || (follow && live.error)) && (
        <p className="text-sm text-destructive">
          {follow ? live.error : failed}
        </p>
      )}
      <LogLines
        entries={shown}
        empty={
          entries === null && !follow ? t("tab.loading") : t("journal.empty")
        }
        className="h-[calc(100vh-260px)] min-h-64"
      />
    </div>
  );
}
