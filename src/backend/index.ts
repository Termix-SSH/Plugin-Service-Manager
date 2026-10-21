import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerFollow } from "./follow.js";
import { createManager } from "./manager.js";
import { createRemote } from "./remote.js";
import { registerRoutes } from "./routes.js";
import { watches } from "./tables.js";
import {
  WatchChecker,
  createWatchAlerts,
  createWatchStore,
} from "./watches.js";

export async function activate(ctx: PluginContext) {
  const remote = createRemote(ctx);
  const store = createWatchStore(ctx, await ctx.db.define(watches));
  const checker = new WatchChecker(ctx, store, remote, createWatchAlerts(ctx));
  checker.start();
  ctx.disposables.add(() => checker.dispose());

  registerRoutes(ctx.http.router<Router>(), ctx, {
    manager: createManager(remote),
    watches: store,
    checker,
  });
  registerFollow(ctx);
  ctx.log.info("Services routes mounted at /plugin-api/service-manager");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
