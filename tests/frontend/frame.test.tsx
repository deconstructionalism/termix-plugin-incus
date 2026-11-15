import { describe, expect, it } from "vitest";
import { checkFrameApp, checkFrameViews } from "@termix-ssh/plugin-sdk/testing";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";

const manifest = manifestJson as unknown as Record<string, unknown>;
const host = {
  id: "1",
  name: "homebrain",
  ip: "10.0.0.1",
  port: 22,
  pluginSettings: { incus: { enableIncus: true } },
};

describe("in a frame", () => {
  it("registers nothing the shell can't take", async () => {
    const { problems } = await checkFrameApp(plugin, { manifest });
    expect(problems).toEqual([]);
  });

  it("asks core only for what a frame may reach", async () => {
    const { refused } = await checkFrameViews(plugin, {
      manifest,
      hosts: [host] as never,
    });
    expect(refused).toEqual([]);
  });
});
