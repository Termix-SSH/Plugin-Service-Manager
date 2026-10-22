import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { ServicesStatus, UnitAction } from "../shared/types.js";
import { UNIT_ACTIONS } from "../shared/types.js";
import { ServicesError } from "./errors.js";
import { readHostSettings, type HostSettings } from "./host-settings.js";
import { parseJournalQuery } from "./journal.js";
import { requireGrep } from "./logfiles.js";
import type { Manager } from "./manager.js";
import { requireLogPath, requireService, requireUnit } from "./names.js";
import { LIST_TYPES, type ListType } from "./systemd.js";
import {
  parseNewService,
  requireEditTarget,
  requireUnitText,
} from "./unit-files.js";
import { MAX_WATCHES, type WatchChecker, type WatchStore } from "./watches.js";

export interface Deps {
  manager: Manager;
  watches: WatchStore;
  checker: WatchChecker;
}

type Level = "connect" | "edit";

/** Maps a thrown error to a JSON answer. Unknown errors are not shown. */
function fail(ctx: PluginContext, res: Response, error: unknown): void {
  if (error instanceof ServicesError) {
    res.status(error.status).json({ error: error.message, ...error.extra });
    return;
  }
  ctx.log.warn(
    `Services request failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  res.status(500).json({ error: "Something went wrong" });
}

/**
 * Mounts the routes on the plugin's router, which core serves at
 * /plugin-api/service-manager with auth in front. Reads need connect access to the
 * host, changes need edit access and a host that is not read only.
 */
export function registerRoutes(
  router: Router,
  ctx: PluginContext,
  deps: Deps,
): void {
  const { manager, watches, checker } = deps;

  router.use(ctx.rbac.require("use") as never);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  async function gate(hostId: number, level: Level): Promise<HostSettings> {
    if (!Number.isInteger(hostId) || hostId < 1) {
      throw new ServicesError("The host id is not valid");
    }
    if (!(await ctx.hosts.checkAccess(hostId, level)).hasAccess) {
      if (
        level === "edit" &&
        (await ctx.hosts.checkAccess(hostId, "connect")).hasAccess
      ) {
        throw new ServicesError("You need edit access to this host", 403, {
          code: "HOST_EDIT_REQUIRED",
        });
      }
      throw new ServicesError("Host not found", 404);
    }
    const settings = await readHostSettings(ctx, hostId);
    if (!settings.enabled) {
      throw new ServicesError("Services is not turned on for this host", 403, {
        code: "disabled",
      });
    }
    if (level === "edit" && settings.readOnly) {
      throw new ServicesError("This host is read only", 403, {
        code: "readOnly",
      });
    }
    return settings;
  }

  const read =
    (
      run: (hostId: number, s: HostSettings, req: Request) => Promise<unknown>,
    ) =>
    async (req: Request, res: Response) => {
      try {
        const hostId = Number(req.params.hostId);
        const settings = await gate(hostId, "connect");
        res.json(await run(hostId, settings, req));
      } catch (error) {
        fail(ctx, res, error);
      }
    };

  /** A change: needs edit access and is written to the audit log. */
  const write =
    (
      action: string,
      run: (hostId: number, s: HostSettings, req: Request) => Promise<unknown>,
      target?: (req: Request) => string | undefined,
    ) =>
    async (req: Request, res: Response) => {
      const hostId = Number(req.params.hostId);
      let name: string | undefined;
      try {
        name = target?.(req);
      } catch {
        name = undefined;
      }
      try {
        const settings = await gate(hostId, "edit");
        const result = await run(hostId, settings, req);
        void ctx.audit.record({
          action: `service-manager.${action}`,
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: name,
          success: true,
        });
        res.json(result ?? { ok: true });
      } catch (error) {
        void ctx.audit.record({
          action: `service-manager.${action}`,
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: name,
          success: false,
          errorMessage: error instanceof Error ? error.message : undefined,
        });
        fail(ctx, res, error);
      }
    };

  const param = (req: Request, key: string) => String(req.params[key] ?? "");
  const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
  const actor = () => String(ctx.currentActor() ?? "");

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/status:
   *   get:
   *     summary: Services status on a host
   *     description: The init system and its version, the OS, whether changes can run as root, whether there is a journal and how many units failed.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The status.
   *       403:
   *         description: Services is not turned on for this host.
   */
  router.get(
    "/:hostId/status",
    read(async (hostId, s): Promise<ServicesStatus> => {
      const found = await manager.detect(hostId, s);
      const canEdit =
        !s.readOnly && (await ctx.hosts.checkAccess(hostId, "edit")).hasAccess;
      return { ...found, canEdit, readOnly: s.readOnly, logRoots: s.logRoots };
    }),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units:
   *   get:
   *     summary: List units
   *     description: Units of one type with their load, active and file state. On OpenRC, the services and their runlevels.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [service, socket, timer, target, path, mount, all]
   *     responses:
   *       200:
   *         description: The units.
   */
  router.get(
    "/:hostId/units",
    read((hostId, s, req) => {
      const raw = String(req.query.type ?? "service");
      const type: ListType =
        raw === "all" || (LIST_TYPES as readonly string[]).includes(raw)
          ? (raw as ListType)
          : "service";
      return manager.units(hostId, s, type);
    }),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units/{unit}:
   *   get:
   *     summary: Unit details
   *     description: Properties such as state, main PID, memory, CPU, tasks, restarts and dependencies, plus the systemctl status text.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The unit.
   */
  router.get(
    "/:hostId/units/:unit",
    read(async (hostId, s, req) => {
      const init = await manager.initOf(hostId, s);
      return manager.detail(
        hostId,
        s,
        requireService(param(req, "unit"), init),
      );
    }),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units/{unit}/actions/{action}:
   *   post:
   *     summary: Run a unit action
   *     description: Start, stop, restart, reload, enable, disable, enable or disable now, mask, unmask, reset a failed state or revert local changes. Needs edit access.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: action
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Done, with the new active state.
   *       403:
   *         description: No edit access, or the host is read only.
   */
  router.post(
    "/:hostId/units/:unit/actions/:action",
    write(
      "unit_action",
      async (hostId, s, req) => {
        const action = param(req, "action");
        if (!(UNIT_ACTIONS as readonly string[]).includes(action)) {
          throw new ServicesError("Unknown action");
        }
        const init = await manager.initOf(hostId, s);
        const unit = requireService(param(req, "unit"), init);
        return manager.action(hostId, s, unit, action as UnitAction);
      },
      (req) => `${param(req, "unit")} ${param(req, "action")}`,
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units/{unit}/file:
   *   get:
   *     summary: Read a unit file
   *     description: The unit file, its drop-ins, the Termix override and the combined view from systemctl cat.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The files.
   */
  router.get(
    "/:hostId/units/:unit/file",
    read((hostId, s, req) =>
      manager.readFile(hostId, s, requireUnit(param(req, "unit"))),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units/{unit}/file/verify:
   *   post:
   *     summary: Check a unit file
   *     description: Runs systemd-analyze verify on the text without saving it. For an override the check covers the unit with every drop-in.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               target:
   *                 type: string
   *                 enum: [unit, override]
   *               text:
   *                 type: string
   *     responses:
   *       200:
   *         description: Whether it passed, with the output.
   */
  router.post(
    "/:hostId/units/:unit/file/verify",
    read((hostId, s, req) => {
      const target = requireEditTarget(body(req).target);
      return manager.verify(
        hostId,
        s,
        requireUnit(param(req, "unit")),
        target,
        requireUnitText(body(req).text, false),
      );
    }),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units/{unit}/file:
   *   put:
   *     summary: Save a unit file
   *     description: Checks the text with systemd-analyze verify, then writes the unit to /etc/systemd/system or its override.conf drop-in, keeps a .termix.bak copy and reloads systemd. An empty override removes it.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               target:
   *                 type: string
   *                 enum: [unit, override]
   *               text:
   *                 type: string
   *     responses:
   *       200:
   *         description: Saved.
   *       400:
   *         description: The check failed. Nothing was written.
   */
  router.put(
    "/:hostId/units/:unit/file",
    write(
      "unit_file_save",
      async (hostId, s, req) => {
        const target = requireEditTarget(body(req).target);
        const text = requireUnitText(body(req).text, target === "override");
        await manager.saveFile(
          hostId,
          s,
          requireUnit(param(req, "unit")),
          target,
          text,
        );
      },
      (req) => param(req, "unit"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units/{unit}/file:
   *   delete:
   *     summary: Delete a unit
   *     description: Stops and disables a unit kept in /etc/systemd/system, removes its file and drop-ins and reloads systemd.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Deleted.
   */
  router.delete(
    "/:hostId/units/:unit/file",
    write(
      "unit_delete",
      (hostId, s, req) =>
        manager.deleteFile(hostId, s, requireUnit(param(req, "unit"))),
      (req) => param(req, "unit"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/units:
   *   post:
   *     summary: Create a service
   *     description: Writes a new service from a form, and a timer when a schedule is given, checks both with systemd-analyze, then enables and starts them when asked.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               description:
   *                 type: string
   *               execStart:
   *                 type: string
   *               type:
   *                 type: string
   *               user:
   *                 type: string
   *               group:
   *                 type: string
   *               workingDirectory:
   *                 type: string
   *               environment:
   *                 type: array
   *                 items:
   *                   type: string
   *               restart:
   *                 type: string
   *               restartSec:
   *                 type: integer
   *               after:
   *                 type: string
   *               wantedBy:
   *                 type: string
   *               enable:
   *                 type: boolean
   *               start:
   *                 type: boolean
   *               onCalendar:
   *                 type: string
   *     responses:
   *       200:
   *         description: The units that were made.
   */
  router.post(
    "/:hostId/units",
    write(
      "unit_create",
      async (hostId, s, req) => ({
        units: await manager.create(hostId, s, parseNewService(body(req))),
      }),
      (req) => String(body(req).name ?? ""),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/timers:
   *   get:
   *     summary: List timers
   *     description: Every timer with its schedule, last and next run and the unit it starts.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The timers.
   */
  router.get(
    "/:hostId/timers",
    read((hostId, s) => manager.timers(hostId, s)),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/journal:
   *   get:
   *     summary: Read the journal
   *     description: Journal entries filtered by unit, priority, time, boot and text, newest last.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: unit
   *         schema:
   *           type: array
   *           items:
   *             type: string
   *       - in: query
   *         name: priority
   *         schema:
   *           type: integer
   *           minimum: 0
   *           maximum: 7
   *       - in: query
   *         name: since
   *         schema:
   *           type: string
   *       - in: query
   *         name: until
   *         schema:
   *           type: string
   *       - in: query
   *         name: boot
   *         schema:
   *           type: string
   *       - in: query
   *         name: grep
   *         schema:
   *           type: string
   *       - in: query
   *         name: kernel
   *         schema:
   *           type: boolean
   *       - in: query
   *         name: lines
   *         schema:
   *           type: integer
   *           maximum: 5000
   *     responses:
   *       200:
   *         description: The entries.
   */
  router.get(
    "/:hostId/journal",
    read((hostId, s, req) =>
      manager.journal(
        hostId,
        s,
        parseJournalQuery(req.query as Record<string, unknown>),
      ),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/journal/boots:
   *   get:
   *     summary: List boots
   *     description: The boots the journal has entries for, newest first.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The boots.
   */
  router.get(
    "/:hostId/journal/boots",
    read((hostId, s) => manager.boots(hostId, s)),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/journal/usage:
   *   get:
   *     summary: Journal disk use
   *     description: How much disk the journal takes.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The size, like 378.6M.
   */
  router.get(
    "/:hostId/journal/usage",
    read((hostId, s) => manager.usage(hostId, s)),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/journal/vacuum:
   *   post:
   *     summary: Shrink the journal
   *     description: Removes old journal files down to a size or an age. Needs edit access.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               size:
   *                 type: string
   *                 example: 500M
   *               time:
   *                 type: string
   *                 example: 4w
   *     responses:
   *       200:
   *         description: Done, with the journalctl output.
   */
  router.post(
    "/:hostId/journal/vacuum",
    write("journal_vacuum", (hostId, s, req) =>
      manager.vacuum(hostId, s, body(req)),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/logs:
   *   get:
   *     summary: List log files
   *     description: Files in the host's allowed log folders, with size and time.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The files.
   */
  router.get(
    "/:hostId/logs",
    read((hostId, s) => manager.logFiles(hostId, s)),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/logs/file:
   *   get:
   *     summary: Read a log file
   *     description: The last lines of a log file, with an optional text search. Compressed files are read too.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: lines
   *         schema:
   *           type: integer
   *       - in: query
   *         name: grep
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The lines.
   *       403:
   *         description: The file is outside the allowed log folders.
   */
  router.get(
    "/:hostId/logs/file",
    read((hostId, s, req) =>
      manager.tail(
        hostId,
        s,
        requireLogPath(req.query.path, s.logRoots),
        Number(req.query.lines) || 500,
        requireGrep(req.query.grep),
      ),
    ),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/logs/download:
   *   get:
   *     summary: Download a log file
   *     description: The file as text, up to its last 4 MB.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The file.
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   */
  router.get("/:hostId/logs/download", async (req, res) => {
    try {
      const hostId = Number(req.params.hostId);
      const settings = await gate(hostId, "connect");
      const path = requireLogPath(req.query.path, settings.logRoots);
      const text = await manager.download(hostId, settings, path);
      const name = (path.split("/").pop() ?? "log").replace(
        /\.(gz|xz|zst|bz2)$/,
        "",
      );
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      );
      res.send(text);
    } catch (error) {
      fail(ctx, res, error);
    }
  });

  /**
   * @openapi
   * /plugin-api/service-manager/watches:
   *   get:
   *     summary: Every watched unit
   *     description: The units the signed in user watches on every host they can still reach with Services on, with the last state seen. Feeds the dashboard card.
   *     tags:
   *       - Services
   *     responses:
   *       200:
   *         description: The watched units with their host.
   */
  router.get("/watches", async (_req: Request, res: Response) => {
    try {
      const user = actor();
      const rows = await watches.listForUser(user);
      const allowed = new Map<number, boolean>();
      const out: Array<{ hostId: number; unit: string; state: string }> = [];
      for (const row of rows) {
        if (!allowed.has(row.hostId)) {
          const access = await ctx.hosts.checkAccess(row.hostId, "connect");
          const on =
            access.hasAccess &&
            (await readHostSettings(ctx, row.hostId)).enabled;
          allowed.set(row.hostId, on);
        }
        if (!allowed.get(row.hostId)) continue;
        out.push({
          hostId: row.hostId,
          unit: row.unit,
          state: checker.stateOf(user, row.hostId, row.unit),
        });
      }
      res.json(out);
    } catch (error) {
      fail(ctx, res, error);
    }
  });

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/watches:
   *   get:
   *     summary: Watched units
   *     description: The units the signed in user gets an alert for on this host, with the last state seen.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The watched units.
   */
  router.get(
    "/:hostId/watches",
    read(async (hostId) => {
      const user = actor();
      return (await watches.list(user, hostId)).map((unit) => ({
        unit,
        state: checker.stateOf(user, hostId, unit),
      }));
    }),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/watches:
   *   post:
   *     summary: Watch a unit
   *     description: Sends the signed in user an alert when the unit fails or stops, and when it runs again.
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               unit:
   *                 type: string
   *     responses:
   *       200:
   *         description: Watching.
   */
  router.post(
    "/:hostId/watches",
    read(async (hostId, _s, req) => {
      const unit = requireUnit(body(req).unit);
      const user = actor();
      const current = await watches.list(user, hostId);
      if (!current.includes(unit) && current.length >= MAX_WATCHES) {
        throw new ServicesError(`You can watch up to ${MAX_WATCHES} units`);
      }
      await watches.add(user, hostId, unit);
      return { ok: true };
    }),
  );

  /**
   * @openapi
   * /plugin-api/service-manager/{hostId}/watches/{unit}:
   *   delete:
   *     summary: Stop watching a unit
   *     tags:
   *       - Services
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: unit
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Not watching any more.
   */
  router.delete(
    "/:hostId/watches/:unit",
    read(async (hostId, _s, req) => {
      await watches.remove(actor(), hostId, requireUnit(param(req, "unit")));
      return { ok: true };
    }),
  );
}
