# Changelog

## 0.3.0

### Changed

- The Operate buttons (Start, Stop, Restart, Freeze, Unfreeze and the snapshot ones) run through Termix's action runner, now that it can hand actions to a plugin process. They show in Operations' run history, follow Termix's approval rules, and need the Operate permission itself: Manage alone no longer covers them.

## 0.2.0

### Added

- Manage, on hosts at Read, operate and manage for people with the Manage permission:
  - A config editor for an instance's own config: secret looking values show as `<hidden>` and keep their real value if left alone, changes are reviewed as a diff before applying, and a change made meanwhile by someone else is never overwritten.
  - Revealing one hidden value at a time from Details, on hosts that allow it, each recorded in the audit log.
  - New instance: a name, an image, profiles from the host, container or VM, and whether to start it.
  - Clone (snapshots optional, with a warning when the instance has a fixed address), Rename and Delete. Rename and Delete need the instance stopped, and Delete needs its name typed.
  - Protected instances can't have their config changed, or be renamed or deleted.

### Changed

- The dashboard card refreshes every 15 seconds, and at once when you come back to the page, instead of once a minute.

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
- A panel beside a host's terminal listing its instances with state, CPU and memory, and a link to the Incus tab.
- A dashboard card with each host's running instances, naming any that are stopped or frozen.
- Shorter labels for the host level, with the details in its description.
- The list's count column is Tasks: Incus counts processes and their threads.
- VMs without the Incus agent show "no agent" where Incus can't measure, and disks the storage doesn't measure show "not reported".
