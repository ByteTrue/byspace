---
title: Troubleshooting
description: Why BySpace can't find a provider you've installed, and how to fix the PATH and environment mismatches behind most setup issues.
nav: Common problems
order: 90
category: Troubleshooting
---

# Troubleshooting

Almost every "it works in my terminal but not in BySpace" problem is the same thing: BySpace and your terminal aren't searching the same `PATH`. This page covers how to spot that and fix it.

## BySpace can't find my provider

A provider you've installed shows as **Not installed**.

BySpace launches the agent CLIs you've already installed; it doesn't bundle them (see [Providers](/docs/providers)). It has to find the command on its own `PATH`. If your shell only adds that location to `PATH` under certain conditions, BySpace can miss it.

### See what BySpace sees

Open **Settings → your host → Providers**, tap the provider, then tap **Diagnostic**. The rows that matter:

- **Resolved path** — where BySpace found the binary, or `not found`.
- **Daemon PATH** — the `PATH` BySpace is searching. Compare it to `echo $PATH` in a fresh terminal.
- **Version** — whether the binary actually runs.

From a terminal or agent, request the same diagnostic from the affected daemon:

```bash
byspace provider diagnostic <provider>
byspace --host <host:port> provider diagnostic <provider> --json
```

Use the global `--host` option when the affected daemon is not the CLI's default local daemon.

`not found` together with a **Daemon PATH** that's missing your binary's directory is the common case: that directory is on your terminal's `PATH` but not on BySpace's.

### Fix it

The durable fix is to make sure the command is on `PATH` for a normal login shell, then restart BySpace; see [why BySpace's environment can differ](#why-byspaces-environment-can-differ-from-your-terminal) for why that's the test that matters.

If you'd rather pin it directly, set the binary path in `~/.byspace/config.json`:

```json
{
  "agents": {
    "providers": {
      "claude": {
        "command": ["/absolute/path/to/claude"]
      }
    }
  }
}
```

`command` is `[binary, ...args]` and fully replaces the default launch command for that provider. Find the real path with `which -a claude`. `type -a claude` also tells you if `claude` is only a shell alias or function; those won't work. BySpace runs the binary directly, so use the path it points to. Reload the configuration after editing (see [below](#i-changed-configjson-but-nothing-happened)).

For alternative endpoints, multiple profiles, custom binaries, and ACP agents, see [Custom providers](/docs/custom-providers). For per-agent install links, see [Supported providers](/docs/supported-providers).

## Why BySpace's environment can differ from your terminal

The same mismatch shows up anywhere BySpace runs your tools: an agent or terminal reports `command not found` for something you use every day.

The daemon inherits the environment it was started with. When you run `byspace` from a terminal, that is your terminal's environment. When the daemon is started by a service manager, container runtime, or launchd unit, it gets that manager's environment instead, which usually has a shorter `PATH`.

BySpace looks for agent binaries by searching `PATH` (`which` on POSIX). The fix for a missing tool lives in your shell config (`.zshrc`, `.zprofile`, …) or in whatever starts the daemon, not in BySpace. Tools installed through version managers (asdf, mise, nvm, …) are the usual offenders: make sure they initialize for a clean login shell, not only inside one you've already opened.

On Windows, BySpace uses the environment it was launched with and resolves commands through `PATHEXT`.

## Reading the logs

- **Daemon** — `~/.byspace/daemon.log` (`$BYSPACE_HOME/daemon.log` if you've set a custom home).

## I changed config.json but nothing happened

Reload the file after editing:

```bash
byspace reload
```

BySpace applies runtime-safe settings and names any paths that require a restart. Invalid JSON or a schema error applies nothing; fix the reported error and run the command again. If a launch environment variable or flag owns a changed setting, reload reports it separately.

Run `byspace daemon restart` only when reload requests it. In the app, open **Settings → your host → Overview** and use **Restart daemon**. Running agents keep going, and clients reconnect automatically.

## Still stuck?

- [Custom providers](/docs/custom-providers) — endpoints, profiles, binaries, ACP agents.
- [Configuration](/docs/configuration) — `config.json`, environment variables, logging.
- [Report an issue](https://github.com/ByteTrue/byspace/issues).
