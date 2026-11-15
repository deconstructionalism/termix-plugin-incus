import { describe, expect, it } from "vitest";
import {
  cgroupName,
  containerFromCgroup,
  containerProcesses,
  instanceProcesses,
  parseSnapshot,
  redactArgs,
  withCpu,
} from "../../src/backend/processes.js";

const ps = [
  "      1       0  12000      9000 0::/init.scope /run/current-system/systemd/lib/systemd/systemd",
  "   4100 1000000  51200      3600 0::/lxc.payload.termix/init.scope node /app/dist/index.js --port 8080",
  "   4200 1001000  20480      3500 0::/lxc.payload.termix/system.slice/app.service nginx: worker process",
  "   4300 1000000   1024        30 0::/lxc.payload.evil/lxc.payload.termix sh -c sleep 100",
  "   4400       0   2048      3600 0::/lxc.monitor.termix [lxc monitor] /var/lib/incus/containers termix",
  "   4500 1065536   4096       600 0::/lxc.payload.lab_old-app/init.scope postgres -c password=hunter2",
].join("\n");

const stat = (ticks: Record<number, [number, number]>) =>
  Object.entries(ticks)
    .map(
      ([pid, [cpu, start]]) =>
        `${pid} (some (odd) name) S 1 1 1 0 -1 4194560 0 0 0 0 ${cpu} 0 0 0 20 0 1 0 ${start} 0 0`,
    )
    .join("\n");

const snapshot = (at: number, ticks: Record<number, [number, number]>) =>
  parseSnapshot(`100\n---\n${ps}\n---\n${stat(ticks)}\n`, at);

describe("processes", () => {
  it("groups host processes by their container, trusting only the first payload cgroup", () => {
    const snap = snapshot(0, {});
    const termix = containerProcesses(snap, "termix", 1000000);
    expect(termix.map((p) => p.pid)).toEqual([4100, 4200]);
    expect(containerProcesses(snap, "evil", null).map((p) => p.pid)).toEqual([
      4300,
    ]);
    expect(containerFromCgroup("0::/lxc.monitor.termix")).toBeNull();
  });

  it("names a container's cgroup by project", () => {
    expect(cgroupName("default", "termix")).toBe("termix");
    expect(cgroupName("lab", "old-app")).toBe("lab_old-app");
    const snap = snapshot(0, {});
    expect(containerProcesses(snap, "lab_old-app", 1000000)[0].pid).toBe(4500);
  });

  it("shows users as inside the container", () => {
    const [node, nginx] = containerProcesses(
      snapshot(0, {}),
      "termix",
      1000000,
    );
    expect(node.innerUid).toBe(0);
    expect(nginx.innerUid).toBe(1000);
    expect(node.rss).toBe(51200 * 1024);
    expect(node.command).toBe("node /app/dist/index.js --port 8080");
  });

  it("works out CPU from two snapshots of the same process", () => {
    const first = snapshot(0, { 4100: [1000, 500], 4200: [50, 600] });
    const second = snapshot(10_000, { 4100: [1500, 500], 4200: [80, 999] });
    const rows = withCpu(
      containerProcesses(second, "termix", 1000000),
      second,
      first,
    );
    expect(rows.find((p) => p.pid === 4100)!.cpuPercent).toBe(50);
    expect(rows.find((p) => p.pid === 4200)!.cpuPercent).toBeNull();
    expect(withCpu(rows, first, null)).toBe(rows);
  });

  it("reads a VM's processes as they are inside", () => {
    const rows = instanceProcesses(snapshot(0, {}));
    expect(rows[0].innerUid).toBe(0);
    expect(rows).toHaveLength(6);
  });

  it("falls back to 100 ticks a second", () => {
    expect(parseSnapshot("\n---\n\n---\n", 0).hz).toBe(100);
  });
});

describe("redactArgs", () => {
  it("blanks values after secret looking names", () => {
    expect(redactArgs("postgres -c password=hunter2")).toBe(
      "postgres -c password=***",
    );
    expect(redactArgs("app --api-key abc123 --port 80")).toBe(
      "app --api-key *** --port 80",
    );
    expect(redactArgs("x --db-password='a b' y")).toBe("x --db-password=*** y");
    expect(redactArgs("curl https://user:pa55@example.com/x")).toBe(
      "curl https://user:***@example.com/x",
    );
    expect(redactArgs("TOKEN=xyz run")).toBe("TOKEN=*** run");
  });

  it("leaves ordinary commands alone", () => {
    expect(redactArgs("nginx: worker process")).toBe("nginx: worker process");
    expect(redactArgs("node /app/dist/index.js --port 8080")).toBe(
      "node /app/dist/index.js --port 8080",
    );
  });

  it("blanks the planted secret in a real looking list", () => {
    const rows = containerProcesses(snapshot(0, {}), "lab_old-app", 1000000);
    expect(JSON.stringify(rows)).not.toContain("hunter2");
  });
});
