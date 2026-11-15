import { describe, expect, it } from "vitest";
import {
  levelAllows,
  normalizeHostSettings,
  parseProtected,
  parseShell,
} from "../../src/backend/settings.js";
import { commandLine, incus } from "../../src/backend/commands.js";

describe("host settings", () => {
  it("falls back to the safest values", () => {
    expect(normalizeHostSettings({})).toEqual({
      enabled: false,
      level: "read",
      protected: [],
      allowShell: false,
      shell: null,
      allowReveal: false,
      incusCommand: "incus",
      pollSeconds: 15,
    });
  });

  it("reads what a host sets", () => {
    const settings = normalizeHostSettings({
      enableIncus: true,
      level: "operate",
      protected: "termix\nauthentik, adguard",
      allowShell: true,
      shell: "/bin/zsh",
      incusCommand: "sudo",
      pollSeconds: 30,
    });
    expect(settings.level).toBe("operate");
    expect(settings.protected).toEqual(["termix", "authentik", "adguard"]);
    expect(settings.shell).toBe("/bin/zsh");
    expect(settings.incusCommand).toBe("sudo");
    expect(settings.pollSeconds).toBe(30);
  });

  it("refuses anything that isn't on the list", () => {
    const settings = normalizeHostSettings({
      enableIncus: "true",
      level: "root",
      incusCommand: "rm -rf /",
      pollSeconds: 1,
    });
    expect(settings.enabled).toBe(false);
    expect(settings.level).toBe("read");
    expect(settings.incusCommand).toBe("incus");
    expect(settings.pollSeconds).toBe(10);
  });

  it("drops protected names Incus wouldn't allow", () => {
    expect(
      parseProtected("ok-name\n-bad\nbad-\n$(id)\n9lives\nok-name"),
    ).toEqual(["ok-name"]);
  });

  it("takes only a plain absolute shell path", () => {
    expect(parseShell("/run/current-system/sw/bin/bash")).toBe(
      "/run/current-system/sw/bin/bash",
    );
    for (const bad of [
      "bash",
      "/bin/sh -c id",
      "/bin/$(id)",
      "/../bin/sh",
      "/bin/sh;id",
    ]) {
      expect(parseShell(bad)).toBeNull();
    }
  });

  it("orders the levels", () => {
    expect(levelAllows("operate", "read")).toBe(true);
    expect(levelAllows("operate", "operate")).toBe(true);
    expect(levelAllows("operate", "manage")).toBe(false);
  });
});

describe("command lines", () => {
  it("builds incus commands from fixed words", () => {
    expect(incus("incus", ["version"])).toBe("incus version");
    expect(incus("sudo", ["list", "--format", "json"])).toBe(
      "sudo -n incus list --format json",
    );
  });

  it("refuses words a shell would read as more", () => {
    for (const bad of [
      "a;b",
      "$(id)",
      "`id`",
      "a b",
      "a|b",
      "a&b",
      ">x",
      "'",
      '"',
      "~",
      "*",
      "a\nb",
      "",
    ]) {
      expect(() => commandLine(["incus", bad])).toThrow(/Refused/);
    }
  });
});

describe("permission ladder", () => {
  it("lets a higher permission stand in for a lower one", async () => {
    const { hasLevel } = await import("../../src/backend/access.js");
    const only = (p: string) => async (q: string) => q === p;
    expect(await hasLevel(only("manage"), "read")).toBe(true);
    expect(await hasLevel(only("manage"), "operate")).toBe(true);
    expect(await hasLevel(only("operate"), "read")).toBe(true);
    expect(await hasLevel(only("operate"), "manage")).toBe(false);
    expect(await hasLevel(only("read"), "operate")).toBe(false);
    expect(await hasLevel(only("shell"), "read")).toBe(false);
  });
});
