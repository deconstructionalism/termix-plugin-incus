import { describe, expect, it } from "vitest";
import {
  actionWords,
  parseResourceKey,
  registerOperations,
} from "../../src/backend/operations.js";
import { InstanceLists } from "../../src/backend/list.js";
import { commandLine } from "../../src/backend/commands.js";
import { listJson } from "./fixtures/list.js";

const termix = { project: "default", name: "termix" };
const words = (...args: Parameters<typeof actionWords>) =>
  commandLine(actionWords(...args));

describe("actionWords", () => {
  it("builds each command from fixed words and checked names", () => {
    expect(words("start", termix, {})).toBe(
      "start --project default -- termix",
    );
    expect(words("stop", termix, {})).toBe(
      "stop --project default --timeout 60 -- termix",
    );
    expect(words("freeze", termix, {})).toBe(
      "pause --project default -- termix",
    );
    expect(words("unfreeze", termix, {})).toBe(
      "resume --project default -- termix",
    );
    expect(words("snapshot-create", termix, { expiry: "7d" })).toBe(
      "snapshot create --project default --expiry 7d -- termix",
    );
    expect(
      words("snapshot-create", termix, { name: "before-upgrade", expiry: "" }),
    ).toBe("snapshot create --project default -- termix before-upgrade");
    expect(words("snapshot-restore", termix, { snapshot: "snap0" })).toBe(
      "snapshot restore --project default -- termix snap0",
    );
  });

  it("refuses names and expiries it doesn't know", () => {
    expect(() =>
      actionWords("snapshot-create", termix, { name: "a b" }),
    ).toThrow();
    expect(() =>
      actionWords("snapshot-create", termix, { expiry: "1y" }),
    ).toThrow();
    expect(() =>
      actionWords("snapshot-delete", termix, { snapshot: "../x" }),
    ).toThrow();
  });

  it("reads a resource key as project/name only", () => {
    expect(parseResourceKey("lab/old-app")).toEqual({
      project: "lab",
      name: "old-app",
    });
    for (const bad of [undefined, "termix", "a/b/c", "x$/y", "default/-x"]) {
      expect(() => parseResourceKey(bad)).toThrow();
    }
  });
});

type Handler = {
  run: (
    input: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<unknown>;
};

function setup(settings: Record<string, unknown>) {
  const handlers = new Map<string, Handler>();
  const commands: string[] = [];
  const ctx = {
    settings: { getAll: async () => settings },
    operations: {
      register: (id: string, handler: Handler) => handlers.set(id, handler),
    },
    ssh: {
      exec: async (_host: unknown, command: string) => {
        commands.push(command);
        return {
          stdout: command.startsWith("incus list") ? listJson : "",
          stderr: "",
          code: 0,
          truncated: false,
          timedOut: false,
        };
      },
    },
  } as never;
  registerOperations(ctx, new InstanceLists(ctx));
  const run = (id: string, key: string, input: Record<string, unknown> = {}) =>
    handlers.get(`incus.${id}`)!.run(input, {
      hostId: 1,
      resourceKey: key,
      runId: "r",
      dryRun: false,
      signal: new AbortController().signal,
      log: () => {},
    });
  return { run, commands, handlers };
}

describe("operations", () => {
  const operate = { enableIncus: true, level: "operate", protected: "termix" };

  it("runs an action on an operate host", async () => {
    const { run, commands } = setup(operate);
    await expect(run("restart", "default/studio")).resolves.toMatchObject({
      changed: true,
    });
    expect(commands.at(-1)).toBe(
      "incus restart --project default --timeout 60 -- studio",
    );
  });

  it("refuses on a read host", async () => {
    const { run, commands } = setup({ enableIncus: true });
    await expect(run("stop", "default/studio")).rejects.toThrow(
      /doesn't allow/,
    );
    expect(commands).toEqual([]);
  });

  it("refuses stopping or restoring a protected instance, but lets it start or snapshot", async () => {
    const { run } = setup(operate);
    for (const action of ["stop", "restart", "freeze"]) {
      await expect(run(action, "default/termix")).rejects.toThrow(/protected/);
    }
    await expect(
      run("snapshot-restore", "default/termix", { snapshot: "snap0" }),
    ).rejects.toThrow(/protected/);
    await expect(run("start", "default/termix")).resolves.toBeTruthy();
    await expect(
      run("snapshot-create", "default/termix", { expiry: "7d" }),
    ).resolves.toBeTruthy();
  });

  it("refuses a snapshot that doesn't exist and an unknown instance", async () => {
    const { run } = setup({ enableIncus: true, level: "operate" });
    await expect(
      run("snapshot-delete", "default/termix", { snapshot: "nope" }),
    ).rejects.toThrow(/No such snapshot/);
    await expect(
      run("snapshot-delete", "default/termix", { snapshot: "snap0" }),
    ).resolves.toBeTruthy();
    await expect(run("start", "default/ghost")).rejects.toThrow(/not found/);
  });

  it("lists instances as resource rows", async () => {
    const { handlers } = setup({ enableIncus: true });
    const result = (await handlers
      .get("incus.list-instances")!
      .run({}, { hostId: 1 })) as {
      data: { rows: { key: string }[] };
    };
    expect(result.data.rows.map((r) => r.key)).toContain("lab/old-app");
  });
});
