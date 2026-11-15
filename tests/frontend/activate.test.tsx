import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { incusEnabled, type Instance } from "../../src/frontend/index";
import { bytes, limitBytes } from "../../src/frontend/format";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;
const host = {
  id: "1",
  name: "homebrain",
  ip: "10.0.0.1",
  port: 22,
  pluginSettings: { incus: { enableIncus: true } },
};

const instance = (over: Partial<Instance>): Instance => ({
  name: "termix",
  project: "default",
  type: "container",
  status: "Running",
  image: "termixssh/termix:26.11.1",
  addresses: [{ family: "inet", address: "10.0.100.66", interface: "eth0" }],
  cpu: { percent: 2.5, limit: null },
  memory: { usage: 268435456, limit: "1GiB" },
  disks: [{ device: "root", usage: null, total: null }],
  processes: 12,
  agent: null,
  ...over,
});

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

async function show(data: unknown) {
  const get = vi.fn(async () => ({ data }));
  rendered = await renderWithApp(plugin, {
    manifest,
    locales,
    api: { get } as never,
  });
  rendered.renderTab("incus", { isVisible: true, host } as never);
  return get;
}

describe(`${manifest.id} activate`, () => {
  it("registers the tab, a terminal panel and a dashboard card", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["incus"]);
    const registered = rendered.registered as unknown as Record<
      string,
      () => unknown[]
    >;
    if (registered.companions) {
      expect(JSON.stringify(registered.companions())).toContain("incus");
    }
    if (registered.dashboardCards) {
      expect(JSON.stringify(registered.dashboardCards())).toContain(
        "incus-hosts",
      );
    }
  });

  it("lists the host's instances", async () => {
    const get = await show({
      ok: true,
      pollSeconds: 15,
      instances: [
        instance({}),
        instance({
          name: "haos",
          type: "virtual-machine",
          image: null,
          addresses: [],
          cpu: { percent: null, limit: null },
          memory: { usage: 3221225472, limit: null },
          processes: null,
          agent: false,
        }),
      ],
    });
    expect(await screen.findByText("termix")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/hosts/1/instances");
    expect(screen.getByText("10.0.100.66")).toBeTruthy();
    expect(screen.getByText("2.5%")).toBeTruthy();
    expect(screen.getByText("256 MiB / 1.0 GiB")).toBeTruthy();
    expect(screen.getAllByText(locales.list.notReported).length).toBe(2);
    expect(screen.getAllByText(locales.list.noAgent).length).toBe(2);
  });

  it("filters by search", async () => {
    await show({
      ok: true,
      pollSeconds: 15,
      instances: [instance({}), instance({ name: "jellyfin" })],
    });
    await screen.findByText("jellyfin");
    fireEvent.change(screen.getByPlaceholderText(locales.list.search), {
      target: { value: "jelly" },
    });
    expect(screen.queryByText("termix")).toBeNull();
    expect(screen.getByText("jellyfin")).toBeTruthy();
  });

  it("opens an instance's processes", async () => {
    const get = vi.fn(async (path: string) => ({
      data: path.endsWith("/processes")
        ? {
            ok: true,
            truncated: false,
            processes: [
              {
                pid: 7,
                uid: 1000000,
                innerUid: 0,
                cpuPercent: 1.5,
                rss: 1048576,
                elapsedSeconds: 3700,
                command: "node /app/index.js",
              },
            ],
          }
        : { ok: true, pollSeconds: 15, instances: [instance({})] },
    }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get } as never,
    });
    rendered.renderTab("incus", { isVisible: true, host } as never);
    fireEvent.click(await screen.findByText("termix"));
    expect(await screen.findByText("node /app/index.js")).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      "/hosts/1/instances/default/termix/processes",
    );
    expect(screen.getByText("root")).toBeTruthy();
    expect(screen.getByText("1h 1m")).toBeTruthy();
  });

  it("confirms an action that worked", async () => {
    const get = vi.fn(async (path: string) => ({
      data: path.endsWith("/processes")
        ? { ok: true, truncated: false, processes: [] }
        : {
            ok: true,
            pollSeconds: 15,
            protected: [],
            shell: false,
            operate: true,
            instances: [instance({})],
          },
    }));
    const post = vi.fn(async () => ({
      data: { ok: true, summary: "Started termix" },
    }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get, post } as never,
    });
    rendered.renderTab("incus", { isVisible: true, host } as never);
    fireEvent.click(await screen.findByText("termix"));
    fireEvent.click(await screen.findByText(locales.actions.restart.label));
    const confirm = await screen.findAllByText(locales.actions.restart.label);
    fireEvent.click(confirm[confirm.length - 1]);
    expect(await screen.findByText("Started termix")).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      "/hosts/1/instances/default/termix/actions/restart",
      { input: {} },
    );
  });

  it("says why Incus didn't answer", async () => {
    await show({ ok: false, error: "incus: command not found" });
    expect(await screen.findByText("incus: command not found")).toBeTruthy();
  });
});

describe("helpers", () => {
  it("reads the host's switch", () => {
    expect(incusEnabled(host)).toBe(true);
    expect(incusEnabled({ pluginSettings: { incus: {} } })).toBe(false);
    expect(incusEnabled(null)).toBe(false);
  });

  it("formats sizes and Incus limits", () => {
    expect(bytes(268435456)).toBe("256 MiB");
    expect(bytes(512)).toBe("512 B");
    expect(limitBytes("1GiB")).toBe(1073741824);
    expect(limitBytes("512MB")).toBe(512_000_000);
    expect(limitBytes("50%")).toBeNull();
  });
});
