import { describe, expect, it } from "vitest";
import { parseInstances, withCpuPercent } from "../../src/backend/instances.js";
import { listJson, SECRET } from "./fixtures/list.js";

const rows = () => parseInstances(listJson);
const byName = (name: string) => rows().find((r) => r.name === name)!;

describe("parseInstances", () => {
  it("never passes on a config or device value it wasn't told to", () => {
    const out = JSON.stringify(rows());
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("environment");
    expect(out).not.toContain("volatile");
    expect(out).not.toContain("hwaddr");
  });

  it("sorts by project, then name", () => {
    expect(rows().map((r) => `${r.project}/${r.name}`)).toEqual([
      "default/haos",
      "default/studio",
      "default/termix",
      "lab/old-app",
    ]);
  });

  it("reads a running container", () => {
    const termix = byName("termix");
    expect(termix.type).toBe("container");
    expect(termix.image).toBe("termixssh/termix:26.11.1");
    expect(termix.addresses).toEqual([
      { family: "inet", address: "10.0.100.66", interface: "eth0" },
    ]);
    expect(termix.memory).toEqual({
      usage: 268435456,
      peak: 300000000,
      swap: null,
      limit: "1GiB",
    });
    expect(termix.network).toEqual({ received: 1000, sent: 2000 });
    expect(termix.processes).toBe(12);
    expect(termix.agent).toBeNull();
  });

  it("lists pool disks even when the storage reports nothing", () => {
    expect(byName("termix").disks).toEqual([
      { device: "cephvol", usage: null, total: null },
      { device: "data", usage: null, total: null },
      { device: "root", usage: null, total: null },
    ]);
    expect(byName("studio").disks).toEqual([
      { device: "root", usage: 21474836480, total: null },
    ]);
  });

  it("knows a VM with its agent from one without", () => {
    expect(byName("studio").agent).toBe(true);
    expect(byName("studio").image).toBe("NixOS 26.05");
    const haos = byName("haos");
    expect(haos.agent).toBe(false);
    expect(haos.processes).toBeNull();
    expect(haos.cpu.usageNs).toBeNull();
    expect(haos.memory.usage).toBe(3221225472);
  });

  it("reports nothing live for a stopped instance", () => {
    const old = byName("old-app");
    expect(old.status).toBe("Stopped");
    expect(old.project).toBe("lab");
    expect(old.startedAt).toBeNull();
    expect(old.memory.usage).toBeNull();
    expect(old.processes).toBeNull();
    expect(old.network).toBeNull();
  });

  it("refuses something that isn't a list", () => {
    expect(() => parseInstances("{}")).toThrow();
    expect(() => parseInstances("not json")).toThrow();
  });
});

describe("withCpuPercent", () => {
  it("needs two readings", () => {
    const first = withCpuPercent(rows(), null, 1_000);
    expect(first.rows.every((r) => r.cpu.percent === null)).toBe(true);

    const later = rows().map((r) =>
      r.name === "termix"
        ? { ...r, cpu: { ...r.cpu, usageNs: r.cpu.usageNs! + 500_000_000 } }
        : r,
    );
    const second = withCpuPercent(later, first.sample, 11_000);
    expect(second.rows.find((r) => r.name === "termix")!.cpu.percent).toBe(5);
    expect(second.rows.find((r) => r.name === "studio")!.cpu.percent).toBe(0);
  });

  it("starts over when the counter goes backwards (a restart)", () => {
    const first = withCpuPercent(rows(), null, 1_000);
    const restarted = rows().map((r) =>
      r.name === "termix" ? { ...r, cpu: { ...r.cpu, usageNs: 10 } } : r,
    );
    const second = withCpuPercent(restarted, first.sample, 11_000);
    expect(
      second.rows.find((r) => r.name === "termix")!.cpu.percent,
    ).toBeNull();
  });
});
