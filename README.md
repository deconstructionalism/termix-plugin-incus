# Incus for Termix

A [Termix](https://github.com/Termix-SSH/Termix) plugin for [Incus](https://linuxcontainers.org/incus/): the containers and VMs on your hosts show up under each host, over the SSH login Termix already has.

**Status: early.** Version 0.1 has the settings, permissions and a tab that checks the host's Incus answers. It needs Termix 26.11.2 or later (plugin API 2).

## Planned

- **Read**: every instance with its state, addresses, CPU, memory, disk and process count; a process table per instance; logs (the journal where there is one, Incus's console log otherwise); config with secret values hidden.
- **Shells** inside instances, separately allowed.
- **Operate**: start, stop, restart, freeze, snapshots, and ending processes where the instance can.
- **Manage**: create, copy, rename, delete, and editing config as YAML with a diff before applying.

## Guard rails

- Each host has a level (read, operate or manage), and only admins can change a host's Incus settings.
- Each level has its own permission, admins only by default.
- Protected instances can't be stopped, restarted, restored or deleted from Termix.
- Values of `environment.*` and secret looking keys never leave the server.
- Commands run over SSH are built from fixed words and checked names only; free text goes on standard input, never in a command line.

See [docs/index.md](docs/index.md) for setting it up.

## Developing

You need Node 24.

```bash
npm install
npm test
npm run typecheck
npm run validate
npm run build
```

## License

Apache-2.0, like Termix's plugin template it started from.
