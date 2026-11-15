The Incus plugin shows the [Incus](https://linuxcontainers.org/incus/) containers and VMs on your hosts, under each host, over the SSH login Termix already has for it.

This is an early version: it lists a host's instances with their usage, and shows each one's processes, logs, details and a shell. Actions come next.

## Turn it on

1. Install the plugin from the Plugins tab, enable it and approve its capabilities.
2. Make sure the host's SSH user can run `incus` without a password: in the `incus-admin` group, or with a passwordless `sudo` rule for `incus`.
3. In the host's editor, under SSH, open Incus, turn it on and choose how to run `incus`. Only admins can change these settings.
4. Open Incus from the host's menu.

## The list

Every instance in every project, with its state, address, CPU, memory, disk and process count. It refreshes while the tab is open, as often as the host's setting says (15 seconds unless changed), and one request serves everyone looking at the same host.

- **CPU** shows from the second refresh: Incus reports a running total, so a percentage takes two readings.
- **Disk** is reported only by some storage drivers. ZFS, Btrfs and LVM report it; the `dir` driver only with project quotas on its filesystem. Otherwise it says "not reported".
- **VMs** report memory without the Incus agent, but not CPU, addresses or processes: those say "no agent".

## What's allowed

Each host has a level, the most anyone may do with its instances:

- **Read**: see instances, their usage, processes, logs and settings, with secret values hidden.
- **Operate**: also start, stop, restart, freeze and snapshot them.
- **Manage**: also create, delete, copy and rename them, and edit their config.

People also need the matching permission (Read, Operate or Manage Incus instances), which only admins have by default. A host's **protected instances** are never stopped, restarted, frozen, restored or deleted from Termix, at any level.

Shells are separate: a host turns them on with Allow shells, and people need the Open shells permission. A root shell in an instance can read everything it holds, secrets included, so they're off by default.

## Processes

Click an instance to see its processes: PID, user, CPU, memory, threads, how long each has run and its command line. The list's Tasks column counts threads too, as Incus does, so it's usually higher than the number of processes. It refreshes every 5 seconds while open.

- **Containers** are read from the host, so it works for images with no `ps` in them. Users show as they are inside the container (`root`, `1000`), worked out from the container's id map.
- **VMs** are read inside, through the Incus agent, and need `ps` and `sh` in the VM. Without the agent it says so.
- CPU shows from the second refresh.
- It needs the host's SSH user to see other users' processes, which it can unless `/proc` is mounted with `hidepid`.

## Logs

- **The journal**, read inside the instance, when it has one (system containers and VMs with the agent).
- **Console output** otherwise, which is what an app container prints. It comes from the file Incus keeps at `/var/log/incus/<instance>/console.log`, so the host's SSH user must be able to read it; Incus makes that folder readable by root only. The plugin never uses `incus console --show-log` on a running container, because reading the console buffer that way empties it.
- The last 500 lines, with a filter.

## Details

Config, devices and snapshots, from the same answer as the list. Values of `environment.*`, `cloud-init.*` and keys whose names look like secrets are hidden on the server.

## Shells

The Shell tab opens a root shell inside a running instance. It shows only when all of these hold, and the server checks them again on every connect:

- the host has **Allow shells** on (off by default)
- you have the **Open shells** permission and edit access to the host
- the instance isn't on the host's protected list
- for a VM, the Incus agent is running

It tries the host's chosen shell first, then `/run/current-system/sw/bin/bash` (NixOS), `/bin/bash` and `/bin/sh`. Closing the tab ends the shell.

## Secret values

Values of `environment.*` keys, and of keys whose names look like secrets (password, secret, token, key), never leave the Termix server. Command lines get the same treatment: a value after an argument whose name looks like a secret (`--password=...`, `-c password=...`, `TOKEN=...`) or a password in a URL is blanked. Hiding them keeps them off the page; it doesn't stop someone with a shell in the instance or on the host from reading them.
