# Changelog

## 0.1.0

### Added

- Host settings for Incus: the switch, what's allowed (read, operate or manage), protected instances, shells, revealing hidden values, how to run `incus` and how often to refresh. Only admins can change them.
- Permissions to read, operate, open shells and manage, each for admins only by default.
- An Incus tab, opened from a host's menu, listing its containers and VMs in every project: state, address, CPU, memory, disk and processes, refreshed while it's open, with search. Only listed fields leave the server, so config values such as `environment.*` never reach the browser.
- Click an instance for its processes, logs and details. Processes: PID, user (as inside the instance), CPU, memory, threads, how long it's run and command line, sortable and searchable, refreshed every 5 seconds. Containers are read from the host, so images with no `ps` work; VMs need the Incus agent. Values after secret looking arguments (password, secret, token, key) are blanked on the server.
- Logs: the journal inside the instance where there is one, otherwise the console output Incus saves to `/var/log/incus/<instance>/console.log` (read with `tail`, never through `incus console --show-log`, which empties a running container's buffer as it reads it). Stopped instances use Incus's saved log.
- Details: config, devices and snapshots, with values of `environment.*`, `cloud-init.*` and secret looking keys hidden on the server.
- A Shell tab: a terminal inside a running instance, for people with the shell permission and edit access, on hosts that allow shells, never for protected instances. It tries the host's chosen shell, then NixOS's bash, `/bin/bash` and `/bin/sh`, and opens bash as a login shell. The server checks everything again on every connect.
- Processes show users as inside the container, using `volatile.idmap.current`, since `volatile.idmap.base` can read 0 while the map starts elsewhere.
- Operate: Start, Stop, Restart, Freeze and Unfreeze buttons, and taking, restoring and deleting snapshots (kept 7 days by default), on hosts at Read and operate or above, for people with Operate. Stop, Restart, Freeze, Restore and Delete ask first, and protected instances only offer Start and Unfreeze. Each action is written to Termix's audit log. They're also declared as Termix operations for the palette and automations, which work once Termix can hand operations to a plugin process.
- Levels and permissions are a ladder, and say so: Manage includes Operate, which includes Read. Shells stay separate.
- Frozen instances: a container's processes still show, marked paused; logs and shells wait until it's unfrozen.
- The list's count column is Tasks: Incus counts processes and their threads.
- VMs without the Incus agent show "no agent" where Incus can't measure, and disks the storage doesn't measure show "not reported".
