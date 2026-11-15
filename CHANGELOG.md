# Changelog

## 0.1.0

### Added

- Host settings for Incus: the switch, what's allowed (read, operate or manage), protected instances, shells, revealing hidden values, how to run `incus` and how often to refresh. Only admins can change them.
- Permissions to read, operate, open shells and manage, each for admins only by default.
- An Incus tab, opened from a host's menu, listing its containers and VMs in every project: state, address, CPU, memory, disk and processes, refreshed while it's open, with search. Only listed fields leave the server, so config values such as `environment.*` never reach the browser.
- Click an instance for its processes, logs and details. Processes: PID, user (as inside the instance), CPU, memory, threads, how long it's run and command line, sortable and searchable, refreshed every 5 seconds. Containers are read from the host, so images with no `ps` work; VMs need the Incus agent. Values after secret looking arguments (password, secret, token, key) are blanked on the server.
- Logs: the journal inside the instance where there is one, otherwise the console output Incus saves to `/var/log/incus/<instance>/console.log` (read with `tail`, never through `incus console --show-log`, which empties a running container's buffer as it reads it). Stopped instances use Incus's saved log.
- Details: config, devices and snapshots, with values of `environment.*`, `cloud-init.*` and secret looking keys hidden on the server.
- The list's count column is Tasks: Incus counts processes and their threads.
- VMs without the Incus agent show "no agent" where Incus can't measure, and disks the storage doesn't measure show "not reported".
