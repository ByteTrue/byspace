# Protocol Compatibility

The app and the daemon ship together from this repo and are updated together. There is one maintainer and a fixed set of devices, all kept current. Version drift is not a supported scenario: no compatibility shims, no feature gates for old hosts, no legacy wire names kept alive. A wire change lands on both sides in the same change.

This replaced the old "always compatible" policy (2026-11-17). If the product ever ships to users who update the app and daemon independently, that decision has to be revisited before any release — the wire has no backward-compatibility guarantees.

The contract binds BySpace to BySpace. The repo is a hard fork of Paseo and the
identity migration renamed the wire names (`isPaseoOwnedWorktree` →
`isBySpaceOwnedWorktree`, the `paseo_worktree_*` RPCs, the `paseo.bearer.*`
subprotocol, the old package scope), so a daemon released before that migration
is not a supported peer. There is no shim for it. See
`bywork/archive/v1/issues/042-x-paseo-identity-migration.md`.

## Schema rules

Schemas live in `packages/protocol/src/messages.ts`. New RPC names follow [rpc-namespacing.md](rpc-namespacing.md).

- Change both sides in the same commit. Removing a field, narrowing a type, and flipping optional to required are all allowed — the daemon and app that parse the new shape ship together.
- Wire schemas are pure structural declarations. No `.transform()`, `.catch()`, or `.preprocess()` on WebSocket message schemas — normalization happens in an explicit pass after validation. The reason is in [protocol-validation.md](protocol-validation.md): inbound validators are generated, and the generator only compiles pure schemas.
- Plain `z.union()` is forbidden when every branch shares a literal tag. Use `z.discriminatedUnion()`.
- `.default()` belongs on primitive leaves only, never on item schemas inside large arrays or big inbound containers.
- A `.strict()` object still rejects unknown keys. That is a design choice about the message's shape, not a compatibility constraint; when the container has to change, change it on both sides.

## server_info.features

`features` on `server_info` carries what the host offers, not which version it is:

- Runtime-state gates stay: `webPush` (VAPID keys configured), `daemonServiceInstall` (platform supports service install), `daemonTunnels` (operator opt-in). These vary per host at the same version.
- Catalogs stay: `agentRoleNames` advertises the daemon's built-in role registry so a new role reaches the app without an app release. A boolean gate is for presence; a list is for membership — advertise names when the client needs to know _what_ the host offers.
- Version gates don't exist. Don't add a flag to detect an old daemon; there are no old daemons.

## Client capability ownership

The client package advertises the protocol behavior it implements. Add each new capability to
its exhaustive defaults and implement the associated subscription or decoding behavior there.
The app and CLI inherit those defaults; they supply only host resources such as browser
automation, or explicit overrides. A schema accepting a message does not establish support for
its delivery semantics.

Connecting creates no timeline or event demand. Client subscriptions own their network membership,
release it on unsubscribe, and restore it after reconnect. Raw message observers inspect traffic
without requesting streams. Application caches and which agents are visible remain caller-owned.

## Relay wire contract

The relay is a separate deployable (hosted Worker, self-hosted Node container), so its wire contract has to be explicit. It is v2 only; v1 (one socket per role) was removed. The relay deploys with the daemon; there is no mixed-version support.

- Endpoint: `GET /ws` upgrade with `role` (`client` | `server`), `serverId`, and `v=2`. `/health` returns `{"status":"ok"}`.
- Missing/invalid params are rejected with HTTP 400 and fixed message strings (`Missing or invalid role parameter`, `Missing serverId parameter`, `Invalid v parameter (expected 2)`).
- One control socket per server (`server-control`), one data socket per connection id (`server:{connectionId}`), many clients per connection id. Clients get `connected`/`disconnected` control notifications; buffered frames (cap 200) flush when the server data socket attaches.
- Frame type is part of the contract: text must arrive as text, binary as binary. `ws` reports it separately from the value (both arrive as a `Buffer`), so inferring "not a string therefore binary" silently converts the plaintext hello and the daemon rejects the handshake. `node-adapter.ts` threads `isBinary` through `normalizeIncoming` for this reason.
- The relay never inspects message payloads beyond plaintext handshake frames; E2EE applies to everything after `e2ee_hello`/`e2ee_ready`.

Behavioral spec: `internal/relay/protocol.go` (the frame router) with two hosts — `internal/relay/relay.go` for the self-hosted relay subcommand and `workers/relay` for the hosted Worker. Both run the same router, so the Worker and the self-hosted relay cannot drift.

## QA

If you touched `packages/protocol`, the question is not "does an old peer still parse this" — it's "did both sides land in the same change, and does `npm run audit` pass". See [qa.md](qa.md).
