import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { incusEnabled } from "../../src/frontend/index";
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

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe(`${manifest.id} activate`, () => {
  it("registers the tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["incus"]);
  });

  it("shows the host's Incus version", async () => {
    const get = vi.fn(async () => ({
      data: { ok: true, client: "7.0.1", server: "7.0.1" },
    }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get } as never,
    });
    rendered.renderTab("incus", { isVisible: true, host } as never);
    expect(
      await screen.findByText("Incus 7.0.1 answers on this host."),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/hosts/1/version");
  });

  it("says why Incus didn't answer", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => ({
          data: { ok: false, error: "incus: command not found" },
        })),
      } as never,
    });
    rendered.renderTab("incus", { isVisible: true, host } as never);
    expect(
      await screen.findByText(
        "Incus didn't answer on this host: incus: command not found",
      ),
    ).toBeTruthy();
  });
});

describe("incusEnabled", () => {
  it("reads the host's switch", () => {
    expect(incusEnabled(host)).toBe(true);
    expect(incusEnabled({ pluginSettings: { incus: {} } })).toBe(false);
    expect(incusEnabled({})).toBe(false);
    expect(incusEnabled(null)).toBe(false);
  });
});
