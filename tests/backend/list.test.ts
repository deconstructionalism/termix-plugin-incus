import { describe, expect, it } from "vitest";
import { InstanceLists, ListError } from "../../src/backend/list.js";
import { normalizeHostSettings } from "../../src/backend/settings.js";
import { listJson } from "./fixtures/list.js";

const settings = normalizeHostSettings({ enableIncus: true, pollSeconds: 10 });

function fakeCtx(
  answer: Partial<{
    stdout: string;
    stderr: string;
    code: number;
    truncated: boolean;
  }>,
) {
  const calls: string[] = [];
  const ctx = {
    ssh: {
      exec: async (_host: unknown, command: string) => {
        calls.push(command);
        await new Promise((r) => setTimeout(r, 5));
        return {
          stdout: answer.stdout ?? listJson,
          stderr: answer.stderr ?? "",
          code: answer.code ?? 0,
          truncated: answer.truncated ?? false,
          timedOut: false,
        };
      },
    },
  };
  return { ctx: ctx as never, calls };
}

describe("InstanceLists", () => {
  it("asks once for everyone looking at the same time", async () => {
    const { ctx, calls } = fakeCtx({});
    const lists = new InstanceLists(ctx);
    const [a, b] = await Promise.all([
      lists.get(1, settings),
      lists.get(1, settings),
    ]);
    expect(a).toBe(b);
    expect(calls).toEqual(["incus list --all-projects --format json"]);
  });

  it("reuses a fresh answer and asks again once it's old", async () => {
    let now = 0;
    const { ctx, calls } = fakeCtx({});
    const lists = new InstanceLists(ctx, () => now);
    now = 1_000;
    await lists.get(1, settings);
    now = 5_000;
    await lists.get(1, settings);
    expect(calls).toHaveLength(1);
    now = 12_000;
    await lists.get(1, settings);
    expect(calls).toHaveLength(2);
  });

  it("treats a cut-off answer as an error, not a short list", async () => {
    const { ctx } = fakeCtx({ truncated: true });
    await expect(
      new InstanceLists(ctx).get(1, settings),
    ).rejects.toBeInstanceOf(ListError);
  });

  it("passes on why incus failed", async () => {
    const { ctx } = fakeCtx({ code: 1, stderr: "Error: not authorized\n" });
    await expect(new InstanceLists(ctx).get(1, settings)).rejects.toThrow(
      "Error: not authorized",
    );
  });

  it("says when the answer isn't readable", async () => {
    const { ctx } = fakeCtx({ stdout: "<html>" });
    await expect(new InstanceLists(ctx).get(1, settings)).rejects.toThrow(
      "wasn't readable",
    );
  });
});
