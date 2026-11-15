export const SECRET = "planted-secret-value-7f3a";

const running = (extra: Record<string, unknown> = {}) => ({
  status: "Running",
  status_code: 103,
  started_at: "2026-11-15T01:00:00Z",
  pid: 1234,
  ...extra,
});

export const instances = [
  {
    name: "termix",
    project: "default",
    type: "container",
    status: "Running",
    description: "",
    profiles: ["default", "apps"],
    created_at: "2026-11-13T10:00:00Z",
    config: { "environment.OIDC_CLIENT_SECRET": SECRET },
    expanded_config: {
      "environment.OIDC_CLIENT_SECRET": SECRET,
      "environment.PORT": "8080",
      "image.description": "termixssh/termix:26.11.1",
      "limits.memory": "1GiB",
      "user.api_token": SECRET,
      "volatile.eth0.hwaddr": "00:16:3e:00:00:01",
      "volatile.idmap.current":
        '[{"Isuid":true,"Isgid":false,"Hostid":1000000,"Nsid":0,"Maprange":1000000000},{"Isuid":false,"Isgid":true,"Hostid":1000000,"Nsid":0,"Maprange":1000000000}]',
    },
    expanded_devices: {
      root: { type: "disk", path: "/", pool: "default" },
      data: {
        type: "disk",
        source: "termix-data",
        pool: "default",
        path: "/app/data",
      },
      eth0: { type: "nic", network: "incusbr0", "ipv4.address": "10.0.100.66" },
      cephvol: {
        type: "disk",
        source: "vol",
        pool: "ceph",
        "ceph.user_key": SECRET,
      },
    },
    snapshots: [
      { name: "snap0", expanded_config: { "environment.X": SECRET } },
    ],
    backups: null,
    state: running({
      processes: 12,
      cpu: { usage: 5_000_000_000, allocated_time: 0 },
      memory: {
        usage: 268435456,
        usage_peak: 300000000,
        total: 0,
        swap_usage: 0,
      },
      disk: { root: { usage: 0, total: 0 } },
      network: {
        lo: {
          addresses: [{ family: "inet", address: "127.0.0.1", scope: "local" }],
          counters: { bytes_received: 1, bytes_sent: 1 },
        },
        eth0: {
          addresses: [
            {
              family: "inet",
              address: "10.0.100.66",
              netmask: "24",
              scope: "global",
            },
            {
              family: "inet6",
              address: "fe80::1",
              netmask: "64",
              scope: "link",
            },
          ],
          counters: { bytes_received: 1000, bytes_sent: 2000 },
        },
      },
    }),
  },
  {
    name: "studio",
    project: "default",
    type: "virtual-machine",
    status: "Running",
    profiles: ["default"],
    expanded_config: {
      "image.os": "NixOS",
      "image.release": "26.05",
      "limits.cpu": "4",
    },
    expanded_devices: { root: { type: "disk", path: "/", pool: "default" } },
    state: running({
      processes: 210,
      cpu: { usage: 90_000_000_000, allocated_time: 0 },
      memory: { usage: 2147483648, usage_peak: 0, total: 8589934592 },
      disk: { root: { usage: 21474836480, total: 0 } },
      network: {
        enp5s0: {
          addresses: [
            { family: "inet", address: "10.0.100.70", scope: "global" },
          ],
          counters: { bytes_received: 5, bytes_sent: 6 },
        },
      },
    }),
  },
  {
    name: "haos",
    project: "default",
    type: "virtual-machine",
    status: "Running",
    profiles: ["haos"],
    expanded_config: {},
    expanded_devices: { root: { type: "disk", path: "/", pool: "default" } },
    state: running({
      processes: -1,
      cpu: { usage: 0, allocated_time: 1_000_000 },
      memory: { usage: 3221225472, usage_peak: 0, total: 4294967296 },
      disk: {},
      network: {},
    }),
  },
  {
    name: "old-app",
    project: "lab",
    type: "container",
    status: "Stopped",
    profiles: ["default"],
    expanded_config: {},
    expanded_devices: {},
    state: {
      status: "Stopped",
      status_code: 102,
      processes: 0,
      cpu: { usage: 0 },
      memory: { usage: 0 },
      disk: {},
      network: null,
      started_at: "0001-01-01T00:00:00Z",
    },
  },
];

export const listJson = JSON.stringify(instances);
