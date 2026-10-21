import type { LogFileView } from "../shared/types.js";
import { ServicesError } from "./errors.js";
import { q } from "./names.js";
import { watchdog } from "./remote.js";

export const MAX_FILES = 3000;
/** The most a download returns, from the end of the file. */
export const DOWNLOAD_BYTES = 4_000_000;

export function listScript(roots: string[]): string {
  return `
for D in ${roots.map(q).join(" ")}; do
  [ -d "$D" ] && find "$D" -maxdepth 4 -type f -exec stat -c '%s|%Y|%n' {} + 2>/dev/null
done | head -n ${MAX_FILES}
exit 0
`;
}

export function parseFileList(output: string): LogFileView[] {
  const files: LogFileView[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\d+)\|(\d+)\|(\/.+)$/.exec(line.trim());
    if (!match) continue;
    files.push({
      path: match[3],
      size: Number(match[1]),
      modified: Number(match[2]) * 1000,
      compressed: /\.(gz|xz|zst|bz2)$/.test(match[3]),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Resolves the real path, checks it is still inside a root, is a file and
 * is readable. Leaves the real path in $R.
 */
function checkPart(path: string, roots: string[]): string {
  return `
P=${q(path)}
R=$(readlink -f -- "$P" 2>/dev/null)
[ -n "$R" ] && [ -f "$R" ] || { echo "SERVICES_ERR:File not found"; exit 1; }
OK=0
for D in ${roots.map(q).join(" ")}; do
  RD=$(readlink -f -- "$D" 2>/dev/null) || continue
  case "$R" in "$RD"/*) OK=1 ;; esac
done
[ "$OK" = 1 ] || { echo "SERVICES_ERR:That file is outside the allowed log folders"; exit 1; }
[ -r "$R" ] || { echo "SERVICES_ERR:No permission to read this file. Turn on Use sudo for this host"; exit 1; }
`;
}

function catCommand(path: string): string {
  if (/\.gz$/.test(path)) return 'gzip -dc -- "$R"';
  if (/\.xz$/.test(path)) return 'xz -dc -- "$R"';
  if (/\.zst$/.test(path)) return 'zstd -dc -- "$R"';
  if (/\.bz2$/.test(path)) return 'bzip2 -dc -- "$R"';
  return "";
}

const BINARY_CHECK = `
if [ "$(head -c 8192 -- "$R" | tr -d -c '\\000' | wc -c)" -gt 0 ]; then echo "SERVICES_ERR:This file is not text"; exit 1; fi
`;

export function tailScript(
  path: string,
  roots: string[],
  lines: number,
  grep: string,
): string {
  const unzip = catCommand(path);
  const n = Math.max(1, Math.min(5000, Math.round(lines)));
  const filter = grep ? ` | grep -i -F -e ${q(grep)}` : "";
  const read = unzip
    ? `${unzip}${filter} | tail -n ${n}`
    : grep
      ? `cat -- "$R"${filter} | tail -n ${n}`
      : `tail -n ${n} -- "$R"`;
  return `${checkPart(path, roots)}${unzip ? "" : BINARY_CHECK}
${read}
exit 0
`;
}

export function downloadScript(path: string, roots: string[]): string {
  const unzip = catCommand(path);
  const read = unzip
    ? `${unzip} | tail -c ${DOWNLOAD_BYTES}`
    : `tail -c ${DOWNLOAD_BYTES} -- "$R"`;
  return `${checkPart(path, roots)}${unzip ? "" : BINARY_CHECK}
${read}
exit 0
`;
}

/** The streamed script for following a file. Compressed files can't grow. */
export function followFileScript(path: string, roots: string[]): string {
  if (catCommand(path)) {
    throw new ServicesError("Compressed files can't be followed");
  }
  return `${checkPart(path, roots)}${BINARY_CHECK}
${watchdog('tail -n 100 -F -- "$R" 2>/dev/null')}`;
}

export function requireGrep(value: unknown): string {
  const grep = typeof value === "string" ? value : "";
  if (grep.length > 200 || /[\r\n\0]/.test(grep)) {
    throw new ServicesError("The search is too long");
  }
  return grep;
}
