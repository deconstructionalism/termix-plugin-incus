import { AsyncResource } from "node:async_hooks";
import { StringDecoder } from "node:string_decoder";
import type {
  PluginContext,
  PluginWebSocketConnection,
} from "@termix-ssh/plugin-sdk/backend";
import { Refusal, requireHost } from "./access.js";
import { incus } from "./commands.js";
import type { InstanceRow } from "./instances.js";
import type { InstanceLists } from "./list.js";
import { GUEST_PATH } from "./logs.js";
import {
  INSTANCE_NAME,
  PROJECT_NAME,
  type IncusHostSettings,
} from "./settings.js";

export const DEFAULT_SHELLS = [
  "/run/current-system/sw/bin/bash",
  "/bin/bash",
  "/bin/sh",
];
const PING_MS = 30_000;
const OPEN = 1;

interface Socket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

interface Stream {
  write(data: string): void;
  end(): void;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  on(event: string, listener: (...args: never[]) => void): void;
  stderr: { on(event: string, listener: (...args: never[]) => void): void };
}

interface Client {
  exec(
    command: string,
    options: { pty?: { term: string; cols: number; rows: number } },
    callback: (err: Error | undefined, stream: Stream) => void,
  ): void;
  exec(
    command: string,
    callback: (err: Error | undefined, stream: Stream) => void,
  ): void;
}

const size = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback;
};

export function shellOrder(settings: IncusHostSettings): string[] {
  return [
    ...new Set([
      ...(settings.shell ? [settings.shell] : []),
      ...DEFAULT_SHELLS,
    ]),
  ];
}

export function execWords(
  instance: InstanceRow,
  shell: string,
  interactive: boolean,
): string[] {
  const login = interactive && shell.endsWith("/bash") ? ["-l"] : [];
  return [
    "exec",
    "--project",
    instance.project,
    ...(interactive ? ["-t"] : ["-T"]),
    "--env",
    GUEST_PATH,
    "--env",
    "TERM=xterm-256color",
    "--",
    instance.name,
    shell,
    ...(interactive ? login : ["-c", "true"]),
  ];
}

function runQuiet(client: Client, command: string): Promise<boolean> {
  return new Promise((resolve) => {
    client.exec(command, (err, stream) => {
      if (err) return resolve(false);
      stream.on("data", () => {});
      stream.stderr.on("data", () => {});
      stream.on("error", () => resolve(false));
      stream.on("close", (code: number) => resolve(code === 0));
    });
  });
}

// Every check, on the server, on every connect: the shell permission, edit
// access, the host's switches and level, and a running, unprotected instance.
export async function allowShell(
  ctx: PluginContext,
  lists: InstanceLists,
  userId: string,
  payload: Record<string, unknown>,
): Promise<{
  hostId: number;
  settings: IncusHostSettings;
  instance: InstanceRow;
}> {
  const project = String(payload.project ?? "");
  const name = String(payload.name ?? "");
  if (!PROJECT_NAME.test(project) || !INSTANCE_NAME.test(name)) {
    throw new Refusal(400, "Not an instance name");
  }
  if (!(await ctx.rbac.hasFor(userId, "shell"))) {
    throw new Refusal(403, "You don't have permission to open shells");
  }
  const { hostId, settings } = await requireHost(ctx, payload.hostId, "read");
  const access = await ctx.hosts.checkAccess(hostId, "edit");
  if (!access.hasAccess) {
    throw new Refusal(403, "Shells need edit access to the host");
  }
  if (!settings.allowShell) {
    throw new Refusal(403, "This host doesn't allow shells");
  }
  if (settings.protected.includes(name)) {
    throw new Refusal(403, "This instance is protected");
  }
  const instance = (await lists.get(hostId, settings)).find(
    (i) => i.project === project && i.name === name,
  );
  if (!instance) throw new Refusal(404, "Instance not found");
  if (instance.status !== "Running") {
    throw new Refusal(403, "The instance isn't running");
  }
  if (instance.type === "virtual-machine" && instance.agent === false) {
    throw new Refusal(403, "This VM has no Incus agent");
  }
  return { hostId, settings, instance };
}

export function registerConsole(
  ctx: PluginContext,
  lists: InstanceLists,
): void {
  const live = new Set<() => void>();
  ctx.disposables.add(() => {
    for (const end of [...live]) end();
    live.clear();
  });

  ctx.ws.route(
    "/console",
    async (connection: PluginWebSocketConnection) => {
      const ws = connection.socket as Socket;
      const userId = connection.userId;
      if (!userId || !(await ctx.rbac.hasFor(userId, "shell"))) {
        ws.close(1008, "Not allowed");
        return;
      }

      let session: { dispose: () => void; stream: Stream | null } | null = null;
      let attempt = 0;
      const send = (message: Record<string, unknown>) => {
        if (ws.readyState === OPEN) ws.send(JSON.stringify(message));
      };
      const endSession = () => {
        const current = session;
        session = null;
        current?.stream?.end();
        current?.dispose();
      };
      const ping = setInterval(() => {
        if (ws.readyState === OPEN) ws.ping();
      }, PING_MS);
      const cleanup = () => {
        attempt++;
        clearInterval(ping);
        endSession();
        live.delete(shutdown);
      };
      const shutdown = () => {
        cleanup();
        try {
          ws.close(1001, "Incus plugin stopped");
        } catch {
          // already closed
        }
      };
      live.add(shutdown);

      const connect = async (payload: Record<string, unknown>) => {
        const mine = ++attempt;
        endSession();
        if (!connection.isDataUnlocked()) {
          send({ type: "error", message: "Session expired, sign in again" });
          return;
        }
        let allowed;
        try {
          allowed = await allowShell(ctx, lists, userId, payload);
        } catch (error) {
          if (error instanceof Refusal) {
            send({ type: "error", message: error.message });
            return;
          }
          throw error;
        }
        const { hostId, settings, instance } = allowed;
        const { client, dispose } = await ctx.ssh.connect<Client>(hostId, {
          purpose: "incus-shell",
          profile: "stream",
          timeoutMs: 60_000,
        });
        if (ws.readyState !== OPEN || mine !== attempt) {
          dispose();
          return;
        }
        const current: { dispose: () => void; stream: Stream | null } = {
          dispose,
          stream: null,
        };
        session = current;

        let shell: string | null = null;
        for (const candidate of shellOrder(settings)) {
          if (
            await runQuiet(
              client,
              incus(
                settings.incusCommand,
                execWords(instance, candidate, false),
              ),
            )
          ) {
            shell = candidate;
            break;
          }
          if (session !== current) return;
        }
        if (!shell) {
          send({ type: "error", message: "This instance has no shell" });
          endSession();
          return;
        }

        client.exec(
          incus(settings.incusCommand, execWords(instance, shell, true)),
          {
            pty: {
              term: "xterm-256color",
              cols: size(payload.cols, 80),
              rows: size(payload.rows, 24),
            },
          },
          (err, stream) => {
            if (err) {
              send({
                type: "error",
                message: `Couldn't start the shell: ${err.message}`,
              });
              return;
            }
            if (session !== current) {
              stream.end();
              return;
            }
            current.stream = stream;
            const decoder = new StringDecoder("utf-8");
            stream.on("data", (chunk: Buffer) => {
              const text = decoder.write(chunk);
              if (text) send({ type: "output", data: text });
            });
            stream.stderr.on("data", () => {});
            stream.on("error", () => {});
            stream.on("close", () => {
              send({ type: "closed" });
              if (session === current) endSession();
            });
            send({ type: "connected", shell });
          },
        );
      };

      ws.on(
        "message",
        AsyncResource.bind(async (raw: unknown) => {
          let message: { type?: unknown; data?: unknown };
          try {
            message = JSON.parse(String(raw));
          } catch {
            return;
          }
          const data =
            message.data && typeof message.data === "object"
              ? (message.data as Record<string, unknown>)
              : {};
          switch (message.type) {
            case "connect":
              try {
                await connect(data);
              } catch {
                send({ type: "error", message: "Couldn't reach the host" });
                endSession();
              }
              break;
            case "input":
              if (typeof message.data === "string")
                session?.stream?.write(message.data);
              break;
            case "resize": {
              const cols = size(data.cols, 0);
              const rows = size(data.rows, 0);
              if (cols && rows)
                session?.stream?.setWindow(rows, cols, rows, cols);
              break;
            }
            case "disconnect":
              attempt++;
              endSession();
              break;
          }
        }),
      );
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    },
    { public: true, optionalAuth: true },
  );
}
