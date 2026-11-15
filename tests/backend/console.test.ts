import { describe, expect, it } from "vitest";
import { createMockCtx } from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import type { PluginHostSummary } from "@termix-ssh/plugin-sdk/backend";
import manifestJson from "../../manifest.json";
import {
  allowShell,
  execWords,
  shellOrder,
} from "../../src/backend/console.js";
import { commandLine } from "../../src/backend/commands.js";
import { InstanceLists } from "../../src/backend/list.js";
import { parseInstances } from "../../src/backend/instances.js";
import { normalizeHostSettings } from "../../src/backend/settings.js";
import { listJson } from "./fixtures/list.js";

const manifest = manifestJson as unknown as PluginManifest;
const termix = parseInstances(listJson).find((i) => i.name === "termix")!;

async function setup(options: {
  permissions?: string[];
  settings?: Record<string, unknown>;
}) {
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    sandbox: true,
    capabilities: manifest.capabilities,
    permissions: options.permissions ?? ["incus.read", "incus.shell"],
    hosts: [
      {
        id: 1,
        userId: "user-1",
        name: "homebrain",
        ip: "10.0.0.1",
        port: 22,
        username: "remote",
        tags: null,
      } as PluginHostSummary,
    ],
  });
  mock.setActor("user-1");
  for (const [key, value] of Object.entries(
    options.settings ?? { enableIncus: true, allowShell: true },
  )) {
    await mock.ctx.settings.setHost(1, key, value);
  }
  mock.ctx.ssh.exec = (async () => ({
    stdout: listJson,
    stderr: "",
    code: 0,
    truncated: false,
    timedOut: false,
  })) as never;
  return { ctx: mock.ctx, lists: new InstanceLists(mock.ctx) };
}

const ask = (name: string, project = "default") => ({
  hostId: 1,
  project,
  name,
});

describe("allowShell", () => {
  it("allows a running instance on a host that allows shells", async () => {
    const { ctx, lists } = await setup({});
    const allowed = await allowShell(ctx, lists, "user-1", ask("termix"));
    expect(allowed.instance.name).toBe("termix");
  });

  it("refuses without the shell permission", async () => {
    const { ctx, lists } = await setup({ permissions: ["incus.read"] });
    await expect(
      allowShell(ctx, lists, "user-1", ask("termix")),
    ).rejects.toThrow(/permission/);
  });

  it("refuses when the host doesn't allow shells", async () => {
    const { ctx, lists } = await setup({ settings: { enableIncus: true } });
    await expect(
      allowShell(ctx, lists, "user-1", ask("termix")),
    ).rejects.toThrow(/doesn't allow shells/);
  });

  it("refuses a protected instance, in any project", async () => {
    const { ctx, lists } = await setup({
      settings: {
        enableIncus: true,
        allowShell: true,
        protected: "termix\nold-app",
      },
    });
    await expect(
      allowShell(ctx, lists, "user-1", ask("termix")),
    ).rejects.toThrow(/protected/);
    await expect(
      allowShell(ctx, lists, "user-1", ask("old-app", "lab")),
    ).rejects.toThrow(/protected/);
  });

  it("refuses stopped instances, VMs without the agent and made up names", async () => {
    const { ctx, lists } = await setup({});
    await expect(
      allowShell(ctx, lists, "user-1", ask("old-app", "lab")),
    ).rejects.toThrow(/isn't running/);
    await expect(allowShell(ctx, lists, "user-1", ask("haos"))).rejects.toThrow(
      /no Incus agent/,
    );
    await expect(allowShell(ctx, lists, "user-1", ask("nope"))).rejects.toThrow(
      /not found/,
    );
    await expect(allowShell(ctx, lists, "user-1", ask("a;b"))).rejects.toThrow(
      /Not an instance/,
    );
  });
});

describe("shell commands", () => {
  it("tries the host's shell first, then the usual ones", () => {
    expect(shellOrder(normalizeHostSettings({ shell: "/bin/zsh" }))).toEqual([
      "/bin/zsh",
      "/run/current-system/sw/bin/bash",
      "/bin/bash",
      "/bin/sh",
    ]);
  });

  it("probes without a terminal and opens bash as a login shell", () => {
    expect(commandLine(execWords(termix, "/bin/sh", false))).toMatch(
      /^exec --project default -T --env PATH=\S+ --env TERM=xterm-256color -- termix \/bin\/sh -c true$/,
    );
    expect(commandLine(execWords(termix, "/bin/bash", true))).toMatch(
      /-t --env PATH=\S+ --env TERM=xterm-256color -- termix \/bin\/bash -l$/,
    );
    expect(
      commandLine(execWords(termix, "/bin/sh", true)).endsWith(
        "termix /bin/sh",
      ),
    ).toBe(true);
  });
});
