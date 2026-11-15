import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import type { PluginHostSummary } from "@termix-ssh/plugin-sdk/backend";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";
import { parseVersion } from "../../src/backend/routes.js";
import { listJson, SECRET } from "./fixtures/list.js";

const manifest = manifestJson as unknown as PluginManifest;

function host(id: number, name: string): PluginHostSummary {
  return {
    id,
    userId: "user-1",
    name,
    ip: `10.0.0.${id}`,
    port: 22,
    username: "remote",
    tags: null,
  } as PluginHostSummary;
}

let server: http.Server | null = null;
let mock: MockPluginContext;
let commands: string[];

async function start(options: {
  permissions?: string[];
  hostSettings?: Record<number, Record<string, unknown>>;
  answer?: { stdout?: string; stderr?: string; code?: number };
  respond?: (command: string) => {
    stdout?: string;
    stderr?: string;
    code?: number;
  };
}) {
  let router: Router | null = null;
  commands = [];
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    sandbox: true,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["incus.read"],
    hosts: [host(1, "homebrain"), host(2, "sidekick")],
  });
  for (const [id, values] of Object.entries(options.hostSettings ?? {})) {
    for (const [key, value] of Object.entries(values)) {
      await mock.ctx.settings.setHost(Number(id), key, value);
    }
  }
  mock.ctx.ssh.exec = (async (_host: unknown, command: string) => {
    commands.push(command);
    const answer = options.respond
      ? options.respond(command)
      : (options.answer ?? {});
    return {
      stdout: answer.stdout ?? "",
      stderr: answer.stderr ?? "",
      code: answer.code ?? 0,
      truncated: false,
      timedOut: false,
    };
  }) as never;
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: response.status, body: await response.json() };
  };
}

afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

const VERSION = "Client version: 7.0.1\nServer version: 7.0.1\n";

describe("GET /summary", () => {
  it("counts each enabled host's instances", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      answer: { stdout: listJson },
    });
    const { status, body } = await get("/summary");
    expect(status).toBe(200);
    expect(body.hosts).toEqual([
      {
        id: 1,
        name: "homebrain",
        ok: true,
        total: 4,
        running: 3,
        stopped: 1,
        frozen: 0,
        down: [{ name: "old-app", project: "lab", status: "Stopped" }],
      },
    ]);
  });

  it("says which host didn't answer", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      answer: { code: 1, stderr: "Error: not reachable" },
    });
    expect((await get("/summary")).body.hosts[0]).toMatchObject({
      ok: false,
      error: "Error: not reachable",
    });
  });
});

describe("GET /hosts", () => {
  it("lists only hosts with Incus turned on", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true, level: "operate" } },
    });
    const { status, body } = await get("/hosts");
    expect(status).toBe(200);
    expect(body.hosts).toEqual([
      { id: 1, name: "homebrain", level: "operate" },
    ]);
  });

  it("refuses someone without the read permission", async () => {
    const get = await start({ permissions: [] });
    expect((await get("/hosts")).status).toBe(403);
  });
});

describe("GET /hosts/:hostId/version", () => {
  it("asks the host's incus", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      answer: { stdout: VERSION },
    });
    const { status, body } = await get("/hosts/1/version");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, client: "7.0.1", server: "7.0.1" });
    expect(commands).toEqual(["incus version"]);
  });

  it("runs it the way the host says", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true, incusCommand: "sudo" } },
      answer: { stdout: VERSION },
    });
    await get("/hosts/1/version");
    expect(commands).toEqual(["sudo -n incus version"]);
  });

  it("says why incus didn't answer", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      answer: { stderr: "incus: command not found", code: 127 },
    });
    const { body } = await get("/hosts/1/version");
    expect(body).toEqual({ ok: false, error: "incus: command not found" });
  });

  it("refuses a host with Incus off, without connecting", async () => {
    const get = await start({});
    expect((await get("/hosts/2/version")).status).toBe(403);
    expect(commands).toEqual([]);
  });

  it("refuses a host the user can't see", async () => {
    const get = await start({ hostSettings: { 1: { enableIncus: true } } });
    expect((await get("/hosts/99/version")).status).toBe(404);
    expect(commands).toEqual([]);
  });

  it("refuses something that isn't a host id", async () => {
    const get = await start({});
    expect((await get("/hosts/1;id/version")).status).toBe(400);
  });
});

describe("GET /hosts/:hostId/instances", () => {
  it("lists instances without a single secret value", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true, protected: "termix" } },
      answer: { stdout: listJson },
    });
    const { status, body } = await get("/hosts/1/instances");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.instances).toHaveLength(4);
    expect(body.protected).toEqual(["termix"]);
    expect(body.shell).toBe(false);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(commands).toEqual(["incus list --all-projects --format json"]);
  });

  it("tells the page whether this user may open shells", async () => {
    const get = await start({
      permissions: ["incus.read", "incus.shell"],
      hostSettings: { 1: { enableIncus: true, allowShell: true } },
      answer: { stdout: listJson },
    });
    expect((await get("/hosts/1/instances")).body.shell).toBe(true);
  });

  it("says why incus didn't answer", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      answer: { stderr: "Error: permission denied", code: 1 },
    });
    const { body } = await get("/hosts/1/instances");
    expect(body).toEqual({ ok: false, error: "Error: permission denied" });
  });

  it("refuses without the read permission or with Incus off", async () => {
    let get = await start({
      permissions: [],
      hostSettings: { 1: { enableIncus: true } },
    });
    expect((await get("/hosts/1/instances")).status).toBe(403);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    get = await start({});
    expect((await get("/hosts/1/instances")).status).toBe(403);
    expect(commands).toEqual([]);
  });
});

describe("GET .../processes", () => {
  const ps = [
    "100\n---",
    "  4100 1000000 51200 3600 11 node /app/index.js",
    "---",
    "4100 (node) S 1 1 1 0 -1 0 0 0 0 0 100 0 0 0 20 0 1 0 500 0 0",
    "---",
    "/proc/4100/cgroup:0::/lxc.payload.termix/init.scope",
    "",
  ].join("\n");
  const respond = (command: string) =>
    command.startsWith("incus list") ? { stdout: listJson } : { stdout: ps };

  it("lists a container's processes from the host", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond,
    });
    const { status, body } = await get(
      "/hosts/1/instances/default/termix/processes",
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.processes.map((p: { pid: number }) => p.pid)).toEqual([4100]);
    expect(commands).toEqual([
      "incus list --all-projects --format json",
      "sh -s",
    ]);
  });

  it("says a VM without its agent can't be read", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond,
    });
    const { body } = await get("/hosts/1/instances/default/haos/processes");
    expect(body).toMatchObject({ ok: false, reason: "no-agent" });
    expect(commands).toEqual(["incus list --all-projects --format json"]);
  });

  it("reads a VM with its agent through incus exec", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond,
    });
    await get("/hosts/1/instances/default/studio/processes");
    expect(commands[1]).toMatch(
      /^incus exec --project default --env PATH=\S+ -- studio sh -s$/,
    );
  });

  it("refuses names that aren't real instances", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond,
    });
    expect(
      (await get("/hosts/1/instances/default/nope/processes")).status,
    ).toBe(404);
    expect((await get("/hosts/1/instances/default/a;b/processes")).status).toBe(
      400,
    );
    expect((await get("/hosts/1/instances/x$y/termix/processes")).status).toBe(
      400,
    );
  });
});

describe("GET .../logs and .../details", () => {
  const listOnly = (command: string) =>
    command.startsWith("incus list") ? { stdout: listJson } : null;

  it("reads the journal inside when there is one", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) =>
        listOnly(c) ?? { stdout: "2026-11-15T01:00:00 host app[1]: up\n" },
    });
    const { body } = await get("/hosts/1/instances/default/termix/logs");
    expect(body).toMatchObject({ ok: true, source: "journal" });
    expect(commands[1]).toMatch(
      /^incus exec --project default --env PATH=\S+ -- termix journalctl --no-pager -n 500 -o short-iso$/,
    );
  });

  it("falls back to the console log file, never the consuming buffer", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) =>
        listOnly(c) ??
        (c.includes("journalctl")
          ? { code: 1, stderr: "Error: Command not found" }
          : { stdout: "listening on 8080\n" }),
    });
    const { body } = await get("/hosts/1/instances/default/termix/logs");
    expect(body).toMatchObject({
      ok: true,
      source: "console",
      text: "listening on 8080\n",
    });
    expect(commands[2]).toBe(
      "tail -n 500 -- /var/log/incus/termix/console.log",
    );
    expect(commands.some((c) => c.includes("console --show-log"))).toBe(false);
  });

  it("asks Incus for a stopped instance's saved console log", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) => listOnly(c) ?? { stdout: "bye\n" },
    });
    const { body } = await get("/hosts/1/instances/lab/old-app/logs");
    expect(body).toMatchObject({ ok: true, source: "console" });
    expect(commands[1]).toBe(
      "incus console --project lab --show-log -- old-app",
    );
  });

  it("says when the log file can't be read", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) =>
        listOnly(c) ??
        (c.includes("journalctl")
          ? { code: 127, stderr: "journalctl: not found" }
          : { code: 1, stderr: "tail: cannot open: Permission denied" }),
    });
    const { body } = await get("/hosts/1/instances/default/termix/logs");
    expect(body).toMatchObject({
      ok: false,
      reason: "unreadable",
      path: "/var/log/incus/termix/console.log",
    });
  });

  it("gives details with secrets hidden", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) => listOnly(c) ?? {},
    });
    const { body } = await get("/hosts/1/instances/default/termix/details");
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.details.profiles).toEqual(["default", "apps"]);
  });
});

describe("frozen instances", () => {
  const frozenList = JSON.stringify(
    JSON.parse(listJson).map(
      (i: { name: string; state: Record<string, unknown> }) =>
        i.name === "termix" || i.name === "studio"
          ? { ...i, status: "Frozen", state: { ...i.state, status: "Frozen" } }
          : i,
    ),
  );
  const ps = [
    "100\n---",
    "  4100 1000000 51200 3600 11 node /app/index.js",
    "---",
    "---",
    "/proc/4100/cgroup:0::/lxc.payload.termix/init.scope",
    "",
  ].join("\n");

  it("still lists a frozen container's processes, marked paused", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) =>
        c.startsWith("incus list") ? { stdout: frozenList } : { stdout: ps },
    });
    const { body } = await get("/hosts/1/instances/default/termix/processes");
    expect(body).toMatchObject({ ok: true, frozen: true });
  });

  it("says a frozen VM can't be read, without asking it", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) =>
        c.startsWith("incus list") ? { stdout: frozenList } : { stdout: ps },
    });
    expect(
      (await get("/hosts/1/instances/default/studio/processes")).body,
    ).toMatchObject({
      ok: false,
      reason: "frozen",
    });
    expect(
      (await get("/hosts/1/instances/default/studio/logs")).body,
    ).toMatchObject({
      ok: false,
      reason: "frozen",
    });
    expect(commands.filter((c) => !c.startsWith("incus list"))).toEqual([]);
  });

  it("never runs journalctl in a frozen container", async () => {
    const get = await start({
      hostSettings: { 1: { enableIncus: true } },
      respond: (c) =>
        c.startsWith("incus list")
          ? { stdout: frozenList }
          : { stdout: "out\n" },
    });
    await get("/hosts/1/instances/default/termix/logs");
    expect(commands.some((c) => c.includes("journalctl"))).toBe(false);
  });
});

describe("manage routes", () => {
  const manageHost = {
    enableIncus: true,
    level: "manage",
    protected: "termix",
  };
  const respond = (c: string) =>
    c.startsWith("incus list")
      ? { stdout: listJson }
      : c.startsWith("incus config show")
        ? {
            stdout:
              'config:\n  environment.KEY: s3cret\n  limits.cpu: "2"\ndevices: {}\n',
          }
        : { stdout: "" };
  const send = async (
    get: Awaited<ReturnType<typeof start>>,
    path: string,
    method: string,
    body: unknown,
  ) => {
    void get;
    const response = await fetch(
      `http://127.0.0.1:${(server!.address() as { port: number }).port}${path}`,
      {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };

  it("refuses everything on an operate host", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: { enableIncus: true, level: "operate" } },
      respond,
    });
    expect((await get("/hosts/1/instances/default/studio/config")).status).toBe(
      403,
    );
  });

  it("refuses without the manage permission", async () => {
    const get = await start({
      permissions: ["incus.operate"],
      hostSettings: { 1: manageHost },
      respond,
    });
    expect((await get("/hosts/1/instances/default/studio/config")).status).toBe(
      403,
    );
  });

  it("shows the config with secrets hidden", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: manageHost },
      respond,
    });
    const { body } = await get("/hosts/1/instances/default/studio/config");
    expect(body.ok).toBe(true);
    expect(body.yaml).not.toContain("s3cret");
    expect(body.allowReveal).toBe(false);
  });

  it("won't edit, rename or delete a protected instance, and won't reveal unless allowed", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: manageHost },
      respond,
    });
    const config = await get("/hosts/1/instances/default/termix/config");
    expect(
      (
        await send(get, "/hosts/1/instances/default/termix/config", "PUT", {
          yaml: config.body.yaml,
          version: config.body.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(
          get,
          "/hosts/1/instances/default/termix/manage/delete",
          "POST",
          { confirm: "termix" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await send(
          get,
          "/hosts/1/instances/default/termix/manage/rename",
          "POST",
          { newName: "t2" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await send(get, "/hosts/1/instances/default/studio/reveal", "POST", {
          key: "environment.KEY",
        })
      ).status,
    ).toBe(403);
  });

  it("asks for the name and a stopped instance before deleting", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: manageHost },
      respond,
    });
    expect(
      (
        await send(
          get,
          "/hosts/1/instances/lab/old-app/manage/delete",
          "POST",
          { confirm: "nope" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          get,
          "/hosts/1/instances/default/studio/manage/delete",
          "POST",
          { confirm: "studio" },
        )
      ).status,
    ).toBe(400);
    const ok = await send(
      get,
      "/hosts/1/instances/lab/old-app/manage/delete",
      "POST",
      { confirm: "old-app" },
    );
    expect(ok.body).toMatchObject({ ok: true });
    expect(commands).toContain("incus delete --project lab -- old-app");
  });

  it("creates from checked names, refusing a taken one", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: manageHost },
      respond,
    });
    expect(
      (
        await send(get, "/hosts/1/instances", "POST", {
          name: "studio",
          image: "images:alpine/3.21",
        })
      ).status,
    ).toBe(400);
    const ok = await send(get, "/hosts/1/instances", "POST", {
      name: "web",
      image: "images:alpine/3.21",
      profiles: ["default"],
    });
    expect(ok.body).toMatchObject({ ok: true });
    expect(commands).toContain(
      "incus launch --project default --profile default -- images:alpine/3.21 web",
    );
  });

  it("clones without snapshots unless asked", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: manageHost },
      respond,
    });
    await send(get, "/hosts/1/instances/default/studio/manage/copy", "POST", {
      newName: "studio2",
    });
    expect(commands).toContain(
      "incus copy --project default --instance-only -- studio studio2",
    );
    await send(get, "/hosts/1/instances/default/studio/manage/copy", "POST", {
      newName: "studio3",
      snapshots: true,
    });
    expect(commands).toContain(
      "incus copy --project default -- studio studio3",
    );
  });

  it("reveals one value where the host allows it", async () => {
    const get = await start({
      permissions: ["incus.manage"],
      hostSettings: { 1: { ...manageHost, allowReveal: true } },
      respond,
    });
    const { body } = await send(
      get,
      "/hosts/1/instances/default/studio/reveal",
      "POST",
      { key: "environment.KEY" },
    );
    expect(body).toEqual({ ok: true, value: "s3cret" });
  });
});

describe("parseVersion", () => {
  it("reads both lines, or neither", () => {
    expect(parseVersion(VERSION)).toEqual({ client: "7.0.1", server: "7.0.1" });
    expect(
      parseVersion("Client version: 6.0.0\nServer version: unreachable"),
    ).toEqual({
      client: "6.0.0",
      server: "unreachable",
    });
    expect(parseVersion("")).toEqual({ client: null, server: null });
  });
});
