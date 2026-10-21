import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import type { JournalEntry } from "../shared/types";
import { priorityClass, timeOnly } from "./format";

/**
 * A scrolling block of journal entries or plain lines. It sticks to the
 * bottom while new lines come in, unless the user scrolled up.
 */
export function LogLines({
  entries,
  lines,
  empty,
  className = "max-h-[60vh]",
  showUnit = true,
}: {
  entries?: JournalEntry[];
  lines?: string[];
  empty?: string;
  className?: string;
  showUnit?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = entries ? entries.length : (lines?.length ?? 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={`min-h-24 overflow-auto border border-border bg-background p-2 font-mono text-[11px] leading-[1.45] thin-scrollbar ${className}`}
    >
      {count === 0 ? (
        <p className="text-muted-foreground">{empty ?? t("logs.empty")}</p>
      ) : entries ? (
        entries.map((entry, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all ${priorityClass(entry.priority)}`}
          >
            <span className="text-muted-foreground">
              {timeOnly(entry.time)}{" "}
            </span>
            {showUnit && (
              <span className="text-accent-brand">
                {entry.ident || entry.unit}
                {entry.pid ? `[${entry.pid}]` : ""}:{" "}
              </span>
            )}
            {entry.message}
          </div>
        ))
      ) : (
        lines!.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
    </div>
  );
}
