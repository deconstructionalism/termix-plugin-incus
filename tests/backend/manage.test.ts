import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  createWords,
  HIDDEN,
  parseProfiles,
  prepareEdit,
  redactConfig,
  revealValue,
  versionOf,
} from "../../src/backend/manage.js";

const SECRET = "planted-secret-value-7f3a";
const raw = `architecture: x86_64
config:
  environment.DB_PASSWORD: ${SECRET}
  image.os: Alpine
  limits.memory: 1GiB
devices:
  data:
    path: /data
    pool: default
    source: data
    type: disk
  vpn:
    type: nic
    vpn.private_key: ${SECRET}
ephemeral: false
profiles:
- default
stateful: false
description: ""
`;

describe("redactConfig", () => {
  it("hides secret looking values in config and devices, nothing else", () => {
    const { yaml, version } = redactConfig(raw);
    expect(yaml).not.toContain(SECRET);
    const doc = parse(yaml);
    expect(doc.config["environment.DB_PASSWORD"]).toBe(HIDDEN);
    expect(doc.config["limits.memory"]).toBe("1GiB");
    expect(doc.devices.vpn["vpn.private_key"]).toBe(HIDDEN);
    expect(doc.devices.data.source).toBe("data");
    expect(version).toBe(versionOf(raw));
  });
});

describe("prepareEdit", () => {
  const { yaml, version } = redactConfig(raw);

  it("keeps the real value of a hidden value left alone", () => {
    const edited = yaml.replace("limits.memory: 1GiB", "limits.memory: 2GiB");
    const out = parse(prepareEdit(edited, version, raw));
    expect(out.config["limits.memory"]).toBe("2GiB");
    expect(out.config["environment.DB_PASSWORD"]).toBe(SECRET);
    expect(out.devices.vpn["vpn.private_key"]).toBe(SECRET);
  });

  it("takes a hidden value that was changed or removed", () => {
    const changed = yaml.replace(
      /environment\.DB_PASSWORD: "?<hidden>"?/,
      "environment.DB_PASSWORD: new-one",
    );
    expect(
      parse(prepareEdit(changed, version, raw)).config[
        "environment.DB_PASSWORD"
      ],
    ).toBe("new-one");
    const removed = yaml.replace(
      / {2}environment\.DB_PASSWORD: "?<hidden>"?\n/,
      "",
    );
    expect(
      Object.keys(parse(prepareEdit(removed, version, raw)).config),
    ).not.toContain("environment.DB_PASSWORD");
  });

  it("refuses when the config changed since it was opened", () => {
    expect(() => prepareEdit(yaml, version, raw + "# changed\n")).toThrow(
      /changed since/,
    );
  });

  it("refuses a placeholder with nothing behind it, and bad YAML or keys", () => {
    const invented = yaml.replace(
      "limits.memory: 1GiB",
      `user.token: "${HIDDEN}"`,
    );
    expect(() => prepareEdit(invented, version, raw)).toThrow(
      /no value to keep/,
    );
    expect(() => prepareEdit("config: [", version, raw)).toThrow(
      /Not valid YAML/,
    );
    expect(() => prepareEdit("- a\n- b\n", version, raw)).toThrow(/mapping/);
    expect(() => prepareEdit("config:\n  'a b': x\n", version, raw)).toThrow(
      /Not a valid key/,
    );
  });
});

describe("revealValue", () => {
  it("gives one hidden value and nothing that isn't hidden", () => {
    expect(revealValue(raw, "environment.DB_PASSWORD")).toBe(SECRET);
    expect(revealValue(raw, "vpn.private_key", "vpn")).toBe(SECRET);
    expect(() => revealValue(raw, "limits.memory")).toThrow();
    expect(() => revealValue(raw, "environment.NOPE")).toThrow();
  });
});

describe("createWords", () => {
  it("builds launch or create from checked names", () => {
    expect(
      createWords({
        project: "default",
        name: "web",
        image: "images:alpine/3.21",
        profiles: ["default"],
        vm: false,
        start: true,
      }),
    ).toEqual([
      "launch",
      "--project",
      "default",
      "--profile",
      "default",
      "--",
      "images:alpine/3.21",
      "web",
    ]);
    expect(
      createWords({
        project: "lab",
        name: "vm1",
        image: "images:debian/12",
        profiles: [],
        vm: true,
        start: false,
      }),
    ).toEqual([
      "create",
      "--project",
      "lab",
      "--vm",
      "--no-profiles",
      "--",
      "images:debian/12",
      "vm1",
    ]);
  });

  it("refuses bad names", () => {
    const base = {
      project: "default",
      name: "ok",
      image: "images:alpine/3.21",
      profiles: [],
      vm: false,
      start: true,
    };
    expect(() => createWords({ ...base, name: "-x" })).toThrow();
    expect(() =>
      createWords({ ...base, image: "images:alpine 3.21" }),
    ).toThrow();
    expect(() => createWords({ ...base, image: "$(id)" })).toThrow();
    expect(() => createWords({ ...base, profiles: ["a;b"] })).toThrow();
  });
});

describe("parseProfiles", () => {
  it("reads names, sorted", () => {
    expect(
      parseProfiles('[{"name":"web"},{"name":"default"},{"name":"bad name"}]'),
    ).toEqual(["default", "web"]);
  });
});
