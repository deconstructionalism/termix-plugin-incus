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
  "      1       0  12000      9000 1 /run/current-system/systemd/lib/systemd/systemd",
  "   4100 1000000  51200      3600 11 node /app/dist/index.js --port 8080",
  "   4200 1001000  20480      3500 1 nginx: worker process",
  "   4300 1000000   1024        30 1 sh -c sleep 100",
  "   4400       0   2048      3600 1 [lxc monitor] /var/lib/incus/containers termix",
  "   4500 1065536   4096       600 3 postgres -c password=hunter2",
  "   4600 1000000   8192      1200 14 celery worker",
].join("\n");

const cgroups = [
  "/proc/1/cgroup:0::/init.scope",
  "/proc/4100/cgroup:0::/lxc.payload.termix/init.scope",
  "/proc/4200/cgroup:0::/lxc.payload.termix/system.slice/app.service",
  "/proc/4300/cgroup:0::/lxc.payload.evil/lxc.payload.termix",
  "/proc/4400/cgroup:0::/lxc.monitor.termix",
  "/proc/4500/cgroup:0::/lxc.payload.lab_old-app/init.scope",
  "/proc/4600/cgroup:0::/lxc.payload.authentik-worker-with-a-long-name",
].join("\n");

const stat = (ticks: Record<number, [number, number]>) =>
  Object.entries(ticks)
    .map(
      ([pid, [cpu, start]]) =>
        `${pid} (some (odd) name) S 1 1 1 0 -1 4194560 0 0 0 0 ${cpu} 0 0 0 20 0 1 0 ${start} 0 0`,
    )
    .join("\n");

const snapshot = (at: number, ticks: Record<number, [number, number]>) =>
  parseSnapshot(`100\n---\n${ps}\n---\n${stat(ticks)}\n---\n${cgroups}\n`, at);

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

  it("matches long container names in full (ps cuts its cgroup column)", () => {
    const snap = snapshot(0, {});
    expect(
      containerProcesses(
        snap,
        "authentik-worker-with-a-long-name",
        1000000,
      ).map((p) => p.pid),
    ).toEqual([4600]);
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
    expect(node.threads).toBe(11);
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
    expect(rows).toHaveLength(7);
  });

  it("falls back to 100 ticks a second", () => {
    expect(parseSnapshot("\n---\n\n---\n\n---\n", 0).hz).toBe(100);
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
