import { and, eq } from "drizzle-orm";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { readHostSettings } from "./host-settings.js";
import type { Remote } from "./remote.js";
import { isActiveScript, parseIsActive } from "./systemd.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const WATCH_TICK_MS = 30_000;
/** Most units one user may watch on one host. */
export const MAX_WATCHES = 50;

export interface WatchRow {
  userId: string;
  hostId: number;
  unit: string;
}

export interface WatchStore {
  list: (userId: string, hostId: number) => Promise<string[]>;
  listAll: () => Promise<WatchRow[]>;
  add: (userId: string, hostId: number, unit: string) => Promise<void>;
  remove: (userId: string, hostId: number, unit: string) => Promise<void>;
}

export function createWatchStore(ctx: PluginContext, table: Table): WatchStore {
  const db = () => ctx.db.client<Drizzle>();
  return {
    async list(userId, hostId) {
      const rows = await (
        await db()
      )
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.hostId, hostId)));
      return (rows as WatchRow[]).map((row) => row.unit).sort();
    },
    async listAll() {
      return (await (await db()).select().from(table)) as WatchRow[];
    },
    async add(userId, hostId, unit) {
      const existing = await this.list(userId, hostId);
      if (existing.includes(unit)) return;
      await (await db()).insert(table).values({ userId, hostId, unit });
      await ctx.db.persist();
    },
    async remove(userId, hostId, unit) {
      await (
        await db()
      )
        .delete(table)
        .where(
          and(
            eq(table.userId, userId),
            eq(table.hostId, hostId),
            eq(table.unit, unit),
          ),
        );
      await ctx.db.persist();
    },
  };
}

export type Change = {
  userId: string;
  hostId: number;
  unit: string;
  from: string;
  to: string;
};

/** States that count as up or down. Others, like activating, wait. */
function bucket(state: string): "up" | "down" | null {
  if (state === "active" || state === "reloading") return "up";
  if (state === "failed" || state === "inactive") return "down";
  return null;
}

/**
 * Checks every watched unit on a timer, as the user who watches it, and
 * reports a unit going down or coming back. The first check only learns the
 * state, so a unit that is already down when Termix starts is not reported.
 */
export class WatchChecker {
  private readonly last = new Map<string, string>();
  private readonly running = new Set<string>();
  private stop: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly ctx: PluginContext,
    private readonly store: WatchStore,
    private readonly remote: Remote,
    private readonly onChange: (change: Change) => Promise<void>,
  ) {}

  start(): void {
    this.stop = this.ctx.schedule.every(WATCH_TICK_MS, () => this.tick(), {
      jitterMs: 5_000,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stop?.();
    this.last.clear();
  }

  /** The last state seen for a unit, or empty. */
  stateOf(userId: string, hostId: number, unit: string): string {
    return this.last.get(`${userId}:${hostId}:${unit}`) ?? "";
  }

  async tick(): Promise<void> {
    if (this.disposed) return;
    let rows: WatchRow[];
    try {
      rows = await this.store.listAll();
    } catch (error) {
      this.ctx.log.warn(`Could not load watched units: ${String(error)}`);
      return;
    }
    const groups = new Map<string, WatchRow[]>();
    for (const row of rows) {
      const key = `${row.userId}:${row.hostId}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const seen = new Set(rows.map((r) => `${r.userId}:${r.hostId}:${r.unit}`));
    for (const key of [...this.last.keys()]) {
      if (!seen.has(key)) this.last.delete(key);
    }
    const jobs: Promise<void>[] = [];
    for (const [key, group] of groups) {
      if (this.running.has(key)) continue;
      this.running.add(key);
      jobs.push(this.check(group).finally(() => this.running.delete(key)));
    }
    await Promise.all(jobs);
  }

  private async check(group: WatchRow[]): Promise<void> {
    const { userId, hostId } = group[0];
    const units = group.map((row) => row.unit);
    try {
      await this.ctx.asUser(userId, async () => {
        const access = await this.ctx.hosts.checkAccess(hostId, "connect");
        if (!access.hasAccess) return;
        const settings = await readHostSettings(this.ctx, hostId);
        if (!settings.enabled) return;
        const { stdout } = await this.remote.read(
          hostId,
          false,
          isActiveScript(units),
          { timeoutMs: 20_000 },
        );
        if (this.disposed) return;
        const states = parseIsActive(units, stdout);
        for (const unit of units) {
          const key = `${userId}:${hostId}:${unit}`;
          const to = states.get(unit) ?? "unknown";
          const from = this.last.get(key);
          const now = bucket(to);
          if (now === null) continue;
          this.last.set(key, to);
          if (from === undefined) continue;
          const before = bucket(from);
          if (before && before !== now) {
            await this.onChange({ userId, hostId, unit, from, to });
          }
        }
      });
    } catch (error) {
      this.ctx.log.debug(
        `Watch check failed for host ${hostId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Sends the watcher an alert when a unit goes down or comes back. */
export function createWatchAlerts(ctx: PluginContext) {
  return async ({ userId, hostId, unit, to }: Change): Promise<void> => {
    try {
      const host = await ctx
        .asUser(userId, () => ctx.hosts.get(hostId))
        .catch(() => null);
      const hostName = host?.name || host?.ip || `#${hostId}`;
      const up = to === "active" || to === "reloading";
      await ctx.notify.send(
        up
          ? {
              title: `${unit} is running again on ${hostName}`,
              severity: "success",
              category: "service-manager.unit_recovered",
              audience: { userId },
              link: { tab: "service-manager" },
              dedupeKey: `service-manager:${hostId}:${unit}:up`,
              context: { hostId, hostName },
            }
          : {
              title: `${unit} ${to === "failed" ? "failed" : "stopped"} on ${hostName}`,
              body: `The unit is now ${to}.`,
              severity: to === "failed" ? "critical" : "warning",
              category: "service-manager.unit_failed",
              audience: { userId },
              link: { tab: "service-manager" },
              dedupeKey: `service-manager:${hostId}:${unit}:down`,
              context: { hostId, hostName },
            },
      );
    } catch (error) {
      ctx.log.warn(
        `Could not send a service alert: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
