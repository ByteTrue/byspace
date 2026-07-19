---
title: Configuration
description: Configure BySpace via config.json, environment variables, and CLI overrides.
nav: Configuration
order: 40
category: Configuration
---

# Configuration

BySpace loads configuration from a single JSON file in your BySpace home directory, with optional environment variable and CLI overrides.

## Where config lives

By default, BySpace uses `~/.byspace` as its home directory. The configuration file is:

```bash
~/.byspace/config.json
```

You can change the home directory by setting `BYSPACE_HOME` or passing `--home` to `byspace daemon start`.

## Precedence

BySpace merges configuration in this order:

1. Defaults
2. `config.json`
3. Environment variables
4. CLI flags

Lists append across sources (for example, `hostnames` and `cors.allowedOrigins`).

## Example

Minimal example that configures listening address, hostnames, and MCP:

```json
{
  "$schema": "https://byspace.pages.dev/schemas/byspace.config.v1.json",
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:6777",
    "hostnames": ["localhost", ".localhost"],
    "mcp": { "enabled": true }
  }
}
```

`daemon.hostnames` is the primary field. The old `daemon.allowedHosts` name still works as a deprecated alias for backward compatibility.

## Agent providers

Agent providers, both the first-class ones BySpace ships with and custom entries you add under `agents.providers`, are documented on their own page.

See [Providers](/docs/providers) for the mental model and [Supported providers](/docs/supported-providers) for the full list of agents BySpace can launch. For pointing Claude at Anthropic-compatible endpoints (Z.AI, Alibaba/Qwen), multiple profiles, custom binaries, ACP agents, and the `additionalModels` merge behavior, see [Custom providers](/docs/custom-providers). The full field reference lives on GitHub at [docs/custom-providers.md](https://github.com/ByteTrue/byspace/blob/main/docs/custom-providers.md).

## Worktrees

New worktrees are created under `$BYSPACE_HOME/worktrees` by default. To place new worktrees somewhere else, set `worktrees.root`:

```json
{
  "worktrees": {
    "root": "/mnt/fast/byspace-worktrees"
  }
}
```

Relative paths are resolved against `BYSPACE_HOME`. Existing worktrees remain where they are; changing this setting only changes where BySpace creates and discovers BySpace-managed worktrees going forward.

## Voice

Voice is configured through `features.dictation` and `features.voiceMode`, with provider credentials under `providers`.

For voice philosophy, architecture, and complete local/OpenAI setup examples, see [Voice docs](/docs/voice).

## Bundled web UI

The daemon can serve the browser Web client from the same HTTP server. Local Docker examples enable it; normal CLI-launched daemons keep it disabled by default.

Enable it from the CLI:

```bash
byspace daemon start --web-ui
```

Or set the environment variable:

```bash
BYSPACE_WEB_UI_ENABLED=true byspace daemon start
```

Or persist it in `config.json`:

```json
{
  "features": {
    "webUi": {
      "enabled": true
    }
  }
}
```

When enabled, open the daemon HTTP origin, for example `http://localhost:6777/`, to load the web app. Static UI files load without daemon auth; API and WebSocket requests still require the configured password.

## Logging

Daemon logging uses separate console and file sinks by default:

- Console: `info` and above
- File (`$BYSPACE_HOME/daemon.log`): `trace` and above
- File rotation: `10m` max file size, `2` retained files total (active + 1 rotated)

```json
{
  "log": {
    "console": {
      "level": "info",
      "format": "pretty"
    },
    "file": {
      "level": "trace",
      "path": "daemon.log",
      "rotate": {
        "maxSize": "10m",
        "maxFiles": 2
      }
    }
  }
}
```

Legacy fields `log.level` and `log.format` are still supported and map to the new destination settings.

## Password authentication

You can require a password to connect to the daemon. When set, all HTTP and WebSocket clients must authenticate. Only the `/api/health` liveness endpoint is exempt, so that process supervisors and load balancers can probe without credentials.

The easiest way to set a password is with the CLI:

```bash
byspace daemon set-password
```

This prompts for a password, writes the bcrypt hash to `config.json`, and tells you to restart the daemon.

Alternatively, set the `BYSPACE_PASSWORD` environment variable (plaintext, hashed automatically at startup):

```bash
BYSPACE_PASSWORD=my-secret byspace daemon start
```

Or write the hash directly in `config.json`:

```json
{
  "daemon": {
    "auth": {
      "password": "$2b$12$..."
    }
  }
}
```

After setting a password, restart the daemon for the change to take effect.

### Connecting with a password

The CLI picks up a password from, in order:

1. The `password` query parameter on a `tcp://` host URI:

   ```bash
   byspace --host "tcp://192.168.1.10:6777?password=my-secret" ls
   ```

2. The `BYSPACE_PASSWORD` environment variable, used as a fallback when the host carries no embedded password (works for `localhost:6777`, bare `host:port`, or `tcp://` hosts without a `password=` query):

   ```bash
   BYSPACE_PASSWORD=my-secret byspace ls
   BYSPACE_PASSWORD=my-secret byspace --host 192.168.1.10:6777 ls
   ```

A `password=` in the URI always wins over the env var, so you can keep `BYSPACE_PASSWORD` set globally and still target a different daemon by spelling its password into the URI.

In the Web app, enter the password in the direct connection setup screen.

## Common env vars

- `BYSPACE_HOME`, set BySpace home directory
- `BYSPACE_PASSWORD`, on the daemon, the password to require (plaintext, hashed at startup); on the CLI, the password used to connect when the host URI doesn't include one
- `BYSPACE_LISTEN`, override `daemon.listen`
- `BYSPACE_HOSTNAMES`, override/extend `daemon.hostnames`
- `BYSPACE_ALLOWED_HOSTS`, deprecated alias for `BYSPACE_HOSTNAMES`
- `BYSPACE_WEB_UI_ENABLED`, enable or disable the daemon-served web UI
- `BYSPACE_WEB_UI_DIST_DIR`, override the daemon web UI build directory
- `BYSPACE_TRUSTED_PROXIES`, configure trusted reverse proxy ranges for `X-Forwarded-*` headers
- `BYSPACE_LOG_CONSOLE_LEVEL`, override `log.console.level`
- `BYSPACE_LOG_FILE_LEVEL`, override `log.file.level`
- `BYSPACE_LOG_FILE_PATH`, override `log.file.path`
- `BYSPACE_LOG_FILE_ROTATE_SIZE`, override `log.file.rotate.maxSize`
- `BYSPACE_LOG_FILE_ROTATE_COUNT`, override `log.file.rotate.maxFiles`
- `BYSPACE_LOG`, `BYSPACE_LOG_FORMAT`, legacy log overrides (still supported)
- `OPENAI_API_KEY`, override OpenAI provider key
- `OPENAI_STT_API_KEY`, `OPENAI_STT_BASE_URL`, OpenAI speech-to-text endpoint (dictation + voice mode STT)
- `OPENAI_TTS_API_KEY`, `OPENAI_TTS_BASE_URL`, OpenAI text-to-speech endpoint (voice mode TTS)
- `BYSPACE_VOICE_LLM_PROVIDER`, override voice LLM provider (`claude`, `codex`, `opencode`)
- `BYSPACE_DICTATION_STT_PROVIDER`, `BYSPACE_VOICE_STT_PROVIDER`, `BYSPACE_VOICE_TTS_PROVIDER`, override voice provider selection (`local` or `openai`)
- `BYSPACE_LOCAL_MODELS_DIR`, control local model directory
- `BYSPACE_DICTATION_LOCAL_STT_MODEL`, override local dictation STT model
- `BYSPACE_VOICE_LOCAL_STT_MODEL`, `BYSPACE_VOICE_LOCAL_TTS_MODEL`, override local voice STT/TTS models
- `BYSPACE_DICTATION_LANGUAGE`, `BYSPACE_VOICE_LANGUAGE`, override dictation and voice STT language
- `BYSPACE_VOICE_LOCAL_TTS_SPEAKER_ID`, `BYSPACE_VOICE_LOCAL_TTS_SPEED`, optional local voice TTS tuning

## Schema

For editor autocomplete/validation, set `$schema` to:

```
https://byspace.pages.dev/schemas/byspace.config.v1.json
```
