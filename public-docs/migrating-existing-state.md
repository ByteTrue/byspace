# Migrating an existing Paseo installation

BySpace uses a separate home directory and never mutates an existing Paseo installation automatically:

- Paseo: `~/.paseo`
- BySpace: `~/.byspace`
- Paseo daemon port: `6767`
- BySpace daemon port: `6777`

A migration should preserve durable identity and history while leaving runtime-only files behind.

## Before you start

1. Finish or stop active agents.
2. Stop the Paseo daemon cleanly.
3. Back up both home directories.
4. Keep the original `~/.paseo` directory until the BySpace daemon, direct connection, and relay connection have all been verified.

## Durable state to preserve

Copy these entries when present:

- `config.json`
- `server-id`
- `daemon-keypair.json`
- `agents/`
- `projects/`
- `schedules/`
- `loops/`
- `chat/`
- provider and model data that is stored outside runtime-only directories

Preserving `server-id` and `daemon-keypair.json` keeps the daemon's relay identity. Existing browser pairings can still require a fresh BySpace pairing link because the hosted Web origin changed.

## Do not copy

Leave these behind:

- PID and socket files
- daemon logs
- stale managed-process records under `runtime/`
- desktop-only attachment or window state
- temporary files and partial downloads

## Configuration changes

Review the migrated `config.json` before starting BySpace:

- change the listen port to `6777`;
- use `byspace-relay.bytetrue.workers.dev:443` with TLS;
- use `https://byspace.pages.dev` as the app base URL and allowed Web origin;
- rename old `PASEO_*` environment settings to `BYSPACE_*`;
- rename internal MCP server metadata from `paseo` to `byspace`;
- rename stored parent-agent labels from `paseo.parent-agent-id` to `byspace.parent-agent-id`.

Provider credentials normally live in each provider CLI's own home directory and do not need to be copied into `$BYSPACE_HOME`.

## Verification

After starting BySpace, verify all of the following before removing any backup:

1. `byspace daemon status` reports the expected home and port.
2. Projects, workspaces, agent history, schedules, and loops are present.
3. Pi and the other configured providers are available.
4. A new pairing link opens `byspace.pages.dev`.
5. Direct and relay connections both work.
6. The old daemon is no longer listening on port `6767`.

Keep the backup for at least one normal work cycle. BySpace's persisted data is JSON and has no rollback migration framework, so the backup is the rollback path.
