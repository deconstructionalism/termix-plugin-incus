# Changelog

## 0.1.0

### Added

- Host settings for Incus: the switch, what's allowed (read, operate or manage), protected instances, shells, revealing hidden values, how to run `incus` and how often to refresh. Only admins can change them.
- Permissions to read, operate, open shells and manage, each for admins only by default.
- An Incus tab, opened from a host's menu, listing its containers and VMs in every project: state, address, CPU, memory, disk and processes, refreshed while it's open, with search. Only listed fields leave the server, so config values such as `environment.*` never reach the browser.
- Click an instance for its processes: PID, user (as inside the instance), CPU, memory, how long it's run and command line, sortable and searchable, refreshed every 5 seconds. Containers are read from the host, so images with no `ps` work; VMs need the Incus agent. Values after secret looking arguments (password, secret, token, key) are blanked on the server.
- VMs without the Incus agent show "no agent" where Incus can't measure, and disks the storage doesn't measure show "not reported".
