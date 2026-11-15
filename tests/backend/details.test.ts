import { describe, expect, it } from "vitest";
import { isHidden, parseDetails } from "../../src/backend/details.js";
import { instances, SECRET } from "./fixtures/list.js";

describe("parseDetails", () => {
  const termix = parseDetails(instances[0]);

  it("hides every secret looking value, in config and devices", () => {
    expect(JSON.stringify(termix)).not.toContain(SECRET);
    const env = termix.config.find((e) => e.key === "environment.PORT");
    expect(env).toEqual({ key: "environment.PORT", value: null });
    expect(
      termix.config.find((e) => e.key === "user.api_token")!.value,
    ).toBeNull();
  });

  it("keeps ordinary values", () => {
    expect(termix.config.find((e) => e.key === "limits.memory")!.value).toBe(
      "1GiB",
    );
    const eth0 = termix.devices.find((d) => d.name === "eth0")!;
    expect(eth0.type).toBe("nic");
    expect(eth0.options).toContainEqual({ key: "network", value: "incusbr0" });
  });

  it("lists snapshots by their own name", () => {
    expect(termix.snapshots.map((s) => s.name)).toEqual(["snap0"]);
  });

  it("hides by prefix and by name", () => {
    for (const key of [
      "environment.ANYTHING",
      "cloud-init.user-data",
      "user.user-data",
      "user.db_password",
      "user.github-token",
      "user.ssh-key",
    ]) {
      expect(isHidden(key)).toBe(true);
    }
    for (const key of [
      "limits.cpu",
      "image.os",
      "boot.autostart",
      "user.note",
    ]) {
      expect(isHidden(key)).toBe(false);
    }
  });
});
