import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileArchive,
  FileText,
  Radio,
  RefreshCw,
} from "lucide-react";
import {
  useToast,
  useTranslation,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Input,
  ListRow,
  PanelList,
  PanelSearch,
  Segmented,
} from "@termix-ssh/plugin-sdk/ui";
import type { LogFileView } from "../shared/types";
import {
  downloadLogFile,
  errorMessage,
  listLogFiles,
  readLogFile,
  saveText,
} from "./api";
import { bytes, dateTime } from "./format";
import { LogLines } from "./LogLines";
import { useFollow } from "./useFollow";

type Lines = "200" | "1000" | "5000";

function FileViewer({
  hostId,
  host,
  file,
  isVisible,
  onBack,
}: {
  hostId: number;
  host?: PluginHostRecord;
  file: LogFileView;
  isVisible: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [lines, setLines] = useState<Lines>("200");
  const [grepText, setGrepText] = useState("");
  const [grep, setGrep] = useState("");
  const [text, setText] = useState<string[] | null>(null);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(false);
  const live = useFollow<string>(
    host,
    { source: "file", path: file.path },
    follow && isVisible,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setText(
        (await readLogFile(hostId, file.path, Number(lines), grep)).lines,
      );
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("files.readFailed")));
    } finally {
      setLoading(false);
    }
  }, [hostId, file.path, lines, grep, t]);

  useEffect(() => {
    if (isVisible && !follow) void load();
  }, [isVisible, follow, load]);

  const download = async () => {
    try {
      const body = await downloadLogFile(hostId, file.path);
      saveText(file.path.split("/").pop() || "log.txt", body);
    } catch (e) {
      toast.error(errorMessage(e, t("files.downloadFailed")));
    }
  };

  const needle = grep.toLowerCase();
  const shown = follow
    ? needle
      ? live.lines.filter((line) => line.toLowerCase().includes(needle))
      : live.lines
    : (text ?? []);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          title={t("common.back")}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="min-w-0 truncate font-mono text-xs">{file.path}</span>
        <span className="text-xs text-muted-foreground">
          {bytes(file.size)} | {dateTime(file.modified)}
        </span>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setGrep(grepText);
        }}
      >
        <Input
          value={grepText}
          onChange={(e) => setGrepText(e.target.value)}
          onBlur={() => setGrep(grepText)}
          placeholder={t("files.searchPlaceholder")}
          aria-label={t("files.search")}
          className="h-8 w-56 text-xs"
        />
        {!follow && (
          <Segmented<Lines>
            value={lines}
            onChange={setLines}
            options={(["200", "1000", "5000"] as Lines[]).map((value) => ({
              value,
              label: t("journal.lineCount", { count: Number(value) }),
            }))}
          />
        )}
        {!file.compressed && (
          <Button
            type="button"
            size="sm"
            variant={follow ? "default" : "outline"}
            onClick={() => setFollow((v) => !v)}
          >
            <Radio className="size-4" />
            {follow ? t("journal.following") : t("journal.follow")}
          </Button>
        )}
        {!follow && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            {t("tab.refresh")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void download()}
        >
          <Download className="size-4" />
          {t("files.download")}
        </Button>
      </form>
      {(failed || (follow && live.error)) && (
        <p className="text-sm text-destructive">
          {follow ? live.error : failed}
        </p>
      )}
      <LogLines
        lines={shown}
        empty={text === null && !follow ? t("tab.loading") : t("files.noLines")}
        className="h-[calc(100vh-240px)] min-h-64"
      />
    </div>
  );
}

export function LogFilesView({
  hostId,
  host,
  roots,
  isVisible,
}: {
  hostId: number;
  host?: PluginHostRecord;
  roots: string[];
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<LogFileView[] | null>(null);
  const [failed, setFailed] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<LogFileView | null>(null);
  const [showOld, setShowOld] = useState(false);

  const load = useCallback(async () => {
    try {
      setFiles(await listLogFiles(hostId));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("files.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  if (open) {
    return (
      <FileViewer
        hostId={hostId}
        host={host}
        file={open}
        isVisible={isVisible}
        onBack={() => setOpen(null)}
      />
    );
  }
  if (failed) return <p className="p-2 text-sm text-destructive">{failed}</p>;
  if (!files) {
    return (
      <p className="p-2 text-xs text-muted-foreground">{t("tab.loading")}</p>
    );
  }

  // Rotated copies like syslog.1 or syslog.2.gz are hidden unless asked for.
  const rotated = (path: string) => /\.\d+(\.(gz|xz|zst|bz2))?$/.test(path);
  const needle = search.trim().toLowerCase();
  const visible = files.filter(
    (file) =>
      (showOld || !rotated(file.path)) &&
      (!needle || file.path.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <PanelSearch
          value={search}
          onChange={setSearch}
          placeholder={t("files.filter")}
          className="min-w-48 flex-1"
        />
        <Button
          size="sm"
          variant={showOld ? "default" : "outline"}
          onClick={() => setShowOld((v) => !v)}
        >
          {t("files.showRotated")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("files.roots", { roots: roots.join(", ") })}
      </p>
      {visible.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground/60">
          {t("files.empty")}
        </p>
      ) : (
        <PanelList>
          {visible.map((file, index) => (
            <ListRow
              key={file.path}
              stripe={index}
              icon={
                file.compressed ? (
                  <FileArchive className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )
              }
              title={<span className="font-mono">{file.path}</span>}
              meta={`${bytes(file.size)} | ${dateTime(file.modified)}`}
              dimmed={file.size === 0}
              onClick={() => setOpen(file)}
            />
          ))}
        </PanelList>
      )}
    </div>
  );
}
