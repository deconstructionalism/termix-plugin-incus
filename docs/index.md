The Incus plugin shows the [Incus](https://linuxcontainers.org/incus/) containers and VMs on your hosts, under each host, over the SSH login Termix already has for it.

This is an early version: it lists a host's instances with their usage. Processes, logs, shells and actions come next.

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

## Secret values

Values of `environment.*` keys, and of keys whose names look like secrets (password, secret, token, key), never leave the Termix server. Hiding them keeps them off the page; it doesn't stop someone with a shell in the instance or on the host from reading them.
