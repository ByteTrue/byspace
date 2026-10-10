# Protocol Compatibility

The app and the daemon are separate products that ship separately. A user updates the app from an app store or a desktop auto-update; they update the daemon when they feel like it. Every combination happens in the wild: new app against an old daemon, old app against a new daemon, and both sides months apart.

In development both sides are always the same version, which is why this is the constraint contributors miss most often.

Two contracts follow from it.

The contract binds BySpace to BySpace. The repo is a hard fork of Paseo and the
identity migration renamed the wire names (`isPaseoOwnedWorktree` →
`isBySpaceOwnedWorktree`, the `paseo_worktree_*` RPCs, the `paseo.bearer.*`
subprotocol, the old package scope), so a daemon released before that migration
is not a supported peer. There is no shim for it. See
`byissue/issues/042-x-paseo-identity-migration.md`.

## The protocol contract: always compatible

A schema change must not break parsing in either direction. An old app still parses messages from a new daemon. A new daemon still parses messages from an old app.

- New fields are `.optional()` with a sensible default.
- Never flip optional to required, remove a field, or narrow a type. `string` to `enum` and nullable to non-null are both narrowing.
- A field you stop sending stays accepted. You stop writing it, you don't stop reading it.
- Wire schemas are pure structural declarations. No `.transform()`, `.catch()`, or `.preprocess()` on WebSocket message schemas — normalization happens in an explicit pass after validation. The reason is in [protocol-validation.md](protocol-validation.md): inbound validators are generated, and the generator only compiles pure schemas.
- Plain `z.union()` is forbidden when every branch shares a literal tag. Use `z.discriminatedUnion()`.
- `.default()` belongs on primitive leaves only, never on item schemas inside large arrays or big inbound containers.

Two questions to ask before you commit a schema change:

1. Does a six-month-old app still parse this message?
2. Does a six-month-old daemon still send something this app accepts?

If you can't answer both with yes, the change isn't done.

Schemas live in `packages/protocol/src/messages.ts`. New RPC names follow [rpc-namespacing.md](rpc-namespacing.md).

## The feature contract: per feature, gated once

Features don't have to work across versions. A new feature usually needs a new daemon capability, and old daemons don't have it.

The app checks for the capability and either runs the feature or tells the user to update the host.

- **No fallback paths.** Don't build a degraded version of the feature for old daemons. Don't fan out across legacy RPCs to simulate a capability that isn't there. The user updates or doesn't get the feature.
- **No defensive branches spread through the feature.** Detection happens in one place, and everything downstream reads a clean shape.
- Capability flags live in `features` on the `server_info` message (`packages/protocol/src/messages.ts`, the `server_info` schema).

Existing functionality keeps working across versions because of the protocol contract. Gating a new feature never substitutes for that.

## Client capability ownership

The client package advertises the protocol behavior it implements. Add each new capability to
its exhaustive defaults and implement the associated subscription or decoding behavior there.
The app, CLI, and plugins inherit those defaults; they supply only host resources such as browser
automation, or explicit overrides. A schema accepting a message does not establish support for
its delivery semantics.

Connecting creates no timeline or event demand. Client subscriptions own their network membership,
release it on unsubscribe, and restore it after reconnect. Raw message observers inspect traffic
without requesting streams. Application caches and which agents are visible remain caller-owned.

## Every shim is tagged and dated

A shim that exists for old-app or old-daemon support carries a comment naming it, the version it arrived in, and when it can go:

```ts
// COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
```

`rg "COMPAT\("` is the full cleanup backlog, so:

- One tag per shim, at the site that has to be deleted.
- Give it a name, a version, and a removal condition or date. Six months out is the usual default.
- Never bury compatibility in an untagged `??` fallback or an optional-chain tunnel. Untagged back-compat never gets removed, because nobody can find it.

When a tag's condition is met, delete the shim and the tag in the same change.

## Relay wire compatibility

The relay is a separate deployable (hosted Worker, self-hosted Node container), so an old relay will meet a new app and daemon, and a new relay will meet old clients. The handshake is frozen:

- Endpoint: `GET /ws` upgrade with `role` (`client` | `server`), `serverId`, and `v` (protocol version, `1` or `2`). `/health` returns `{"status":"ok"}`.
- Missing/invalid params are rejected with HTTP 400 and fixed message strings (`Missing or invalid role parameter`, `Missing serverId parameter`, `Invalid v parameter (expected 1 or 2)`).
- `v=1`: one client and one server socket per `serverId`, new connections replace old ones (close 1008), blind bidirectional forwarding.
- `v=2`: one control socket per server (`server-control`), one data socket per connection id (`server:{connectionId}`), many clients per connection id. Clients get `connected`/`disconnected` control notifications; buffered frames (cap 200) flush when the server data socket attaches.
- Frame type is part of the contract: text must arrive as text, binary as binary. `ws` reports it separately from the value (both arrive as a `Buffer`), so inferring "not a string therefore binary" silently converts the plaintext hello and the daemon rejects the handshake. `node-adapter.ts` threads `isBinary` through `normalizeIncoming` for this reason.
- The relay never inspects message payloads beyond plaintext handshake frames; E2EE applies to everything after `e2ee_hello`/`e2ee_ready`.

Behavioral spec: `packages/relay/src/cloudflare-adapter.ts` (production) and `packages/relay/src/node-adapter.ts` (self-hosted, issue 061). Node e2e (`node-relay-e2e.test.ts`) asserts parity with the Worker. Changes to these semantics are protocol-breaking and need the same two-questions treatment as schema changes.

## QA

Tests don't fully cover compatibility. If you touched `packages/protocol`, say in the pull request why an older app still parses your message and why an older daemon still satisfies your app. See [qa.md](qa.md).
