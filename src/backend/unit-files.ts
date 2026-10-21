import type {
  EditTarget,
  NewServiceInput,
  UnitFileView,
} from "../shared/types.js";
import { ServicesError } from "./errors.js";
import { isUnit, isWritableUnitName, q } from "./names.js";

export const UNIT_DIR = "/etc/systemd/system";
/** Largest unit file we take. */
export const MAX_UNIT_BYTES = 64 * 1024;

const MARK = (name: string) => `@@TERMIX_${name}@@`;

export function readFileScript(unit: string): string {
  const u = q(unit);
  return `
U=${u}
FRAG=$(systemctl show -p FragmentPath --value -- "$U" 2>/dev/null)
echo "fragment=$FRAG"
echo "dropins=$(systemctl show -p DropInPaths --value -- "$U" 2>/dev/null)"
echo "${MARK("CAT")}"
systemctl cat --no-pager -- "$U" 2>/dev/null
echo "${MARK("FRAG")}"
[ -n "$FRAG" ] && [ -f "$FRAG" ] && cat -- "$FRAG"
echo "${MARK("OVERRIDE")}"
[ -f "${UNIT_DIR}/$U.d/override.conf" ] && cat -- "${UNIT_DIR}/$U.d/override.conf"
exit 0
`;
}

function between(text: string, start: string, end?: string): string {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const rest = text.slice(from + start.length).replace(/^\n/, "");
  if (!end) return rest;
  const to = rest.indexOf(end);
  return to < 0 ? rest : rest.slice(0, to);
}

export function parseFileView(unit: string, output: string): UnitFileView {
  const head = output.slice(0, Math.max(0, output.indexOf(MARK("CAT"))));
  const keys: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) keys[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  const fragmentPath = keys.fragment ?? "";
  const overridePath = `${UNIT_DIR}/${unit}.d/override.conf`;
  return {
    name: unit,
    combined: between(output, MARK("CAT"), MARK("FRAG")).trimEnd(),
    fragmentPath,
    fragment: between(output, MARK("FRAG"), MARK("OVERRIDE")).replace(
      /\n$/,
      "",
    ),
    dropIns: (keys.dropins ?? "").split(/\s+/).filter(Boolean),
    override: between(output, MARK("OVERRIDE")).replace(/\n$/, ""),
    overridePath,
    local: fragmentPath.startsWith(`${UNIT_DIR}/`),
    writable: isWritableUnitName(unit),
  };
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/**
 * Builds the file systemd would see into $T/<unit> and verifies it. For an
 * override that is the unit file, its other drop-ins, then the new text.
 */
function verifyPart(unit: string, target: EditTarget, text: string): string {
  const u = q(unit);
  const override = `${UNIT_DIR}/${unit}.d/override.conf`;
  return `
U=${u}
T=$(mktemp -d /tmp/termix-services.XXXXXX) || { echo "SERVICES_ERR:Could not make a temp folder"; exit 1; }
trap 'rm -rf "$T"' EXIT
printf '%s' '${b64(text)}' | base64 -d > "$T/new" || { echo "SERVICES_ERR:Could not write the file"; exit 1; }
if [ "${target}" = "override" ]; then
  FRAG=$(systemctl show -p FragmentPath --value -- "$U" 2>/dev/null)
  {
    [ -n "$FRAG" ] && [ -f "$FRAG" ] && cat -- "$FRAG" && echo
    for D in $(systemctl show -p DropInPaths --value -- "$U" 2>/dev/null); do
      [ "$D" = ${q(override)} ] && continue
      [ -f "$D" ] && cat -- "$D" && echo
    done
    cat "$T/new"
  } > "$T/$U"
else
  cp "$T/new" "$T/$U"
fi
OUT=$(systemd-analyze verify --man=no "$T/$U" 2>&1)
RC=$?
OUT=$(printf '%s\\n' "$OUT" | sed "s#$T/##g")
`;
}

export function verifyScript(
  unit: string,
  target: EditTarget,
  text: string,
): string {
  return `${verifyPart(unit, target, text)}
echo "rc=$RC"
echo "${MARK("OUT")}"
printf '%s\\n' "$OUT"
`;
}

export function parseVerify(output: string): { ok: boolean; output: string } {
  const rc = /^rc=(\d+)/m.exec(output)?.[1];
  return {
    ok: rc === "0",
    output: between(output, MARK("OUT")).trim(),
  };
}

/** Verifies, then writes the unit or its override and reloads systemd. */
export function saveScript(
  unit: string,
  target: EditTarget,
  text: string,
  options: { mustBeNew?: boolean } = {},
): string {
  const dest =
    target === "override"
      ? `${UNIT_DIR}/${unit}.d/override.conf`
      : `${UNIT_DIR}/${unit}`;
  const empty = target === "override" && !text.trim();
  const fresh = options.mustBeNew
    ? `
LS=$(systemctl show -p LoadState --value -- ${q(unit)} 2>/dev/null)
if [ -e ${q(dest)} ] || { [ -n "$LS" ] && [ "$LS" != "not-found" ]; }; then echo "SERVICES_ERR:A unit with this name already exists"; exit 1; fi`
    : "";
  if (empty) {
    return `
D=${q(dest)}
if [ -f "$D" ]; then cp -p "$D" "$D.termix.bak" && rm -f -- "$D"; fi
rmdir ${q(`${UNIT_DIR}/${unit}.d`)} 2>/dev/null
systemctl daemon-reload || { echo "SERVICES_ERR:systemctl daemon-reload failed"; exit 1; }
echo "saved=1"
`;
  }
  return `${fresh}
${verifyPart(unit, target, text)}
if [ "$RC" != "0" ]; then
  printf '%s\\n' "$OUT" | sed 's/^/SERVICES_ERR:/'
  exit 1
fi
D=${q(dest)}
mkdir -p "$(dirname -- "$D")" || exit 1
[ -f "$D" ] && cp -p "$D" "$D.termix.bak"
cat "$T/new" > "$D.termix.tmp" && chmod 644 "$D.termix.tmp" && mv -f "$D.termix.tmp" "$D" || { echo "SERVICES_ERR:Could not write $D"; exit 1; }
systemctl daemon-reload || { echo "SERVICES_ERR:systemctl daemon-reload failed"; exit 1; }
echo "saved=1"
`;
}

/** Stops, turns off and removes a unit file kept in /etc/systemd/system. */
export function deleteScript(unit: string): string {
  const u = q(unit);
  return `
U=${u}
FRAG=$(systemctl show -p FragmentPath --value -- "$U" 2>/dev/null)
case "$FRAG" in
  ${UNIT_DIR}/*) ;;
  *) echo "SERVICES_ERR:Only unit files in ${UNIT_DIR} can be deleted. Use Revert for others"; exit 1 ;;
esac
systemctl disable --now -- "$U" >/dev/null 2>&1
rm -f -- "$FRAG"
rm -rf -- "${UNIT_DIR}/$U.d"
systemctl daemon-reload || { echo "SERVICES_ERR:systemctl daemon-reload failed"; exit 1; }
systemctl reset-failed -- "$U" >/dev/null 2>&1
echo "deleted=1"
`;
}

export function requireEditTarget(value: unknown): EditTarget {
  if (value === "unit" || value === "override") return value;
  throw new ServicesError("target must be unit or override");
}

export function requireUnitText(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new ServicesError("text is required");
  if (Buffer.byteLength(value, "utf8") > MAX_UNIT_BYTES) {
    throw new ServicesError("The file is too big");
  }
  if (!allowEmpty && !value.trim()) {
    throw new ServicesError("The file is empty");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new ServicesError("The file has characters that are not allowed");
  }
  return value.endsWith("\n") || !value ? value : `${value}\n`;
}

const SERVICE_TYPES = ["simple", "exec", "forking", "oneshot", "notify"];
const RESTARTS = ["no", "on-failure", "always", "on-abnormal"];
const ACCOUNT_RE = /^[a-z_][a-z0-9_-]{0,31}\$?$/i;
const TARGET_RE = /^[A-Za-z0-9:_.@-]+\.target$/;

function oneLine(value: unknown, field: string, max = 4096): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (/[\r\n]/.test(text)) throw new ServicesError(`${field} must be one line`);
  if (text.length > max) throw new ServicesError(`${field} is too long`);
  return text;
}

/** Checks a new service form and fills in the defaults. */
export function parseNewService(
  body: Record<string, unknown>,
): NewServiceInput {
  let name = oneLine(body.name, "Name", 200);
  if (name && !name.includes(".")) name = `${name}.service`;
  if (!name.endsWith(".service") || !isWritableUnitName(name)) {
    throw new ServicesError("Give the service a simple name, like my-app");
  }
  const execStart = oneLine(body.execStart, "Command");
  if (!execStart.startsWith("/")) {
    throw new ServicesError(
      "The command must start with a full path, like /usr/bin/node",
    );
  }
  const type = String(body.type ?? "simple");
  if (!SERVICE_TYPES.includes(type)) throw new ServicesError("Unknown type");
  const restart = String(body.restart ?? "on-failure");
  if (!RESTARTS.includes(restart)) throw new ServicesError("Unknown restart");
  const user = oneLine(body.user, "User", 32);
  const group = oneLine(body.group, "Group", 32);
  if (user && !ACCOUNT_RE.test(user)) throw new ServicesError("Bad user name");
  if (group && !ACCOUNT_RE.test(group)) {
    throw new ServicesError("Bad group name");
  }
  const workingDirectory = oneLine(body.workingDirectory, "Folder", 1024);
  if (workingDirectory && !workingDirectory.startsWith("/")) {
    throw new ServicesError("The folder must be a full path");
  }
  const environment = (
    Array.isArray(body.environment) ? body.environment : []
  ).map((entry) => oneLine(entry, "Environment", 2048));
  for (const entry of environment) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(entry)) {
      throw new ServicesError("Environment lines look like NAME=value");
    }
  }
  const after = oneLine(body.after, "After", 1024);
  for (const unit of after.split(/\s+/).filter(Boolean)) {
    if (!isUnit(unit)) throw new ServicesError(`Unknown unit ${unit}`);
  }
  const wantedBy =
    oneLine(body.wantedBy, "Start with", 200) || "multi-user.target";
  if (!TARGET_RE.test(wantedBy)) {
    throw new ServicesError("Start with must be a target");
  }
  const onCalendar = oneLine(body.onCalendar, "Schedule", 200);
  const restartSec = Number(body.restartSec ?? 5);
  return {
    name,
    description: oneLine(body.description, "Description", 300) || name,
    execStart,
    type: type as NewServiceInput["type"],
    user,
    group,
    workingDirectory,
    environment,
    restart: restart as NewServiceInput["restart"],
    restartSec:
      Number.isFinite(restartSec) && restartSec >= 0 && restartSec <= 3600
        ? Math.round(restartSec)
        : 5,
    after,
    wantedBy,
    enable: body.enable !== false,
    start: body.start !== false,
    onCalendar,
  };
}

/** Quotes an Environment= value for systemd when it has spaces. */
function envValue(entry: string): string {
  return /[\s"\\]/.test(entry)
    ? `"${entry.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : entry;
}

export function serviceText(input: NewServiceInput): string {
  const timer = Boolean(input.onCalendar);
  const lines = ["[Unit]", `Description=${input.description}`];
  if (input.after) lines.push(`After=${input.after}`);
  lines.push("", "[Service]", `Type=${timer ? "oneshot" : input.type}`);
  lines.push(`ExecStart=${input.execStart}`);
  if (input.user) lines.push(`User=${input.user}`);
  if (input.group) lines.push(`Group=${input.group}`);
  if (input.workingDirectory) {
    lines.push(`WorkingDirectory=${input.workingDirectory}`);
  }
  for (const entry of input.environment) {
    lines.push(`Environment=${envValue(entry)}`);
  }
  if (!timer && input.restart !== "no") {
    lines.push(`Restart=${input.restart}`, `RestartSec=${input.restartSec}`);
  }
  if (!timer) lines.push("", "[Install]", `WantedBy=${input.wantedBy}`);
  return `${lines.join("\n")}\n`;
}

export function timerText(input: NewServiceInput): string {
  return [
    "[Unit]",
    `Description=Runs ${input.name} on a schedule`,
    "",
    "[Timer]",
    `OnCalendar=${input.onCalendar}`,
    "Persistent=true",
    `Unit=${input.name}`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/** Checks an OnCalendar value with systemd-analyze calendar. */
export function calendarScript(value: string): string {
  return `systemd-analyze calendar -- ${q(value)} >/dev/null 2>&1 || { echo "SERVICES_ERR:The schedule is not a valid OnCalendar value"; exit 1; }\necho ok=1\n`;
}

/** Enables and starts what the form asked for after the files are written. */
export function afterCreateScript(input: NewServiceInput): string {
  const unit = input.onCalendar
    ? input.name.replace(/\.service$/, ".timer")
    : input.name;
  const steps: string[] = [];
  if (input.enable && input.start) {
    steps.push(`systemctl enable --now -- ${q(unit)} 2>&1 || exit 1`);
  } else if (input.enable) {
    steps.push(`systemctl enable -- ${q(unit)} 2>&1 || exit 1`);
  } else if (input.start) {
    steps.push(`systemctl start -- ${q(unit)} 2>&1 || exit 1`);
  }
  return `${steps.join("\n")}\necho done=1\n`;
}
