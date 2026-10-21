import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type {
  PluginHostAccess,
  PluginSshExecResult,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const manifest = manifestJson as unknown as PluginManifest;
const pluginDir = fileURLToPath(new URL("../..", import.meta.url));

export interface Call {
  hostId: number;
  command: string;
  stdin: string;
}

export interface FakeSsh {
  calls: Call[];
  /** Replies by a piece of the script text. The first match wins. */
  replies: Array<{
    match: string;
    stdout?: string;
    stderr?: string;
    code?: number;
  }>;
}

export interface TestServer {
  mock: MockPluginContext;
  ssh: FakeSsh;
  hostSettings: Record<string, unknown>;
  request: (
    method: string,
    path: string,
    body?: unknown,
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any; text: string }>;
  close: () => Promise<void>;
}

/** The plugin on a real express app, with ctx.ssh.exec played by a fake. */
export async function startServer(
  options: {
    permissions?: string[];
    level?: PluginHostAccess["permissionLevel"] | "none";
    hostSettings?: Record<string, unknown>;
    exec?: (
      hostId: number,
      command: string,
      stdin: string,
    ) => Promise<PluginSshExecResult>;
  } = {},
): Promise<TestServer> {
  let router: Router | null = null;
  const db = await createTestDb(pluginDir);
  // Watches point at a real user and host, as on the server.
  db.sqlite.exec(
    "INSERT INTO users (id) VALUES ('user-1'), ('user-2'); INSERT INTO ssh_data (id) VALUES (1), (2);",
  );
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["service-manager.use"],
  });
  mock.setActor("user-1");

  const hostSettings: Record<string, unknown> = {
    enableServices: true,
    ...options.hostSettings,
  };
  Object.assign(mock.ctx.settings, {
    getAll: async (scope: string) => (scope === "host" ? hostSettings : {}),
  });

  const rank = { connect: 1, view: 2, edit: 3, manage: 4 } as const;
  const level = options.level ?? "manage";
  Object.assign(mock.ctx.hosts, {
    checkAccess: async (
      _id: number,
      need: keyof typeof rank = "connect",
    ): Promise<PluginHostAccess> => ({
      hasAccess: level !== "none" && rank[level] >= rank[need],
      isOwner: true,
      isShared: false,
      permissionLevel: level === "none" ? undefined : level,
    }),
  });

  const ssh: FakeSsh = { calls: [], replies: [] };
  Object.assign(mock.ctx.ssh, {
    exec: async (
      hostId: number,
      command: string,
      opts?: { stdin?: string },
    ) => {
      const stdin = opts?.stdin ?? "";
      ssh.calls.push({ hostId, command, stdin });
      if (options.exec) return options.exec(hostId, command, stdin);
      const reply = ssh.replies.find((r) => stdin.includes(r.match));
      return {
        stdout: reply?.stdout ?? "",
        stderr: reply?.stderr ?? "",
        code: reply?.code ?? 0,
        truncated: false,
        timedOut: false,
      };
    },
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    mock,
    ssh,
    hostSettings,
    async request(method, path, body) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed, text };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
