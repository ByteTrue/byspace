# Issue: Daemon Remote Web Services

**ID:** 002-o-daemon-remote-web-services
**Epic:** 004-o-private-remote-web-services
**Status:** open
**Priority:** P0
**Created:** 2026-08-20

## Goal

Implement the daemon-owned Remote Web Service backend on top of the WSS Data Relay adapter proven by Issue 001, with any daemon optionally hosting it on a separate listener.

## Scope

- Add optional static Data Relay Host/Client configuration. A host daemon binds a separate listener and advertises a public endpoint; client daemons connect to that endpoint. No hosted default is invented.
- Add source-owned atomic persistence for remote service mappings.
- Report target Data Relay configuration through `server_info` and add list/create/delete source-mapping RPCs.
- Add stable `<name>.remote.localhost` routes to the existing Service Proxy.
- Route only parsed HTTP and explicit WebSocket upgrades from those local hostnames.
- Bridge each active request/upgrade over a dedicated E2EE Data Relay channel to the target daemon's chosen loopback port.
- Use bounded byte-window flow control rather than per-frame acknowledgements.
- Preserve HTTP streaming/SSE and WebSocket/HMR.
- Fail an active request on disconnect while retaining the mapping for later requests.

## Non-goals

- Public URLs or browser-only remote access.
- AI-specific behavior.
- Arbitrary-TCP UI/API.
- Request replay or SSE continuation.
- P2P/TURN.
- Mutable Data Relay settings UI.

## Acceptance criteria

- [x] Data Relay settings load from environment and expose host listen, client/public endpoint, TLS and access-token settings.
- [x] A daemon with `BYSPACE_DATA_RELAY_LISTEN` starts and stops an authenticated Relay listener independently from its main API.
- [x] Target-side Data Relay transport starts only when configured and accepts E2EE channels.
- [x] Mappings survive source daemon restart and keep the same hostname.
- [x] Source Service Proxy handles HTTP, SSE and WebSocket/HMR through the remote route.
- [x] Only target loopback ports `1..65535` are accepted; no target hostname is configurable.
- [x] Remote route requests are accepted only from a loopback source socket.
- [x] Buffers and in-flight streams are bounded.
- [x] Disconnect fails the active stream, leaves the mapping intact, and a later request reconnects.
- [x] Control Relay traffic and Data Relay traffic remain physically separate.
- [x] B-hosted tunnel and VPS-hosted reverse-proxy topologies are documented; their shared daemon Host/Client lifecycle is covered by automated tests.
- [x] Protocol changes are backward-compatible and capability-gated.
- [x] A target independently authorizes the source inside E2EE, without trusting the Relay bandwidth token.
- [x] Replayed data/control frames are rejected before duplicate plaintext reaches a loopback service.
- [x] The App preserves `server_info.dataRelay` through initial and live ingestion paths.
- [x] Desktop and compact Playwright E2E cover list/create/remove, capability gating, restart persistence and screenshots.
- [ ] Linux and Windows CI complete without RemoteByteStream unhandled rejections.

## Verification

```bash
npx vitest run packages/protocol/src/<remote-web-service-test> --bail=1
npx vitest run packages/server/src/server/remote-web-service/<tests> --bail=1
npx vitest run packages/server/src/server/service-proxy.test.ts --bail=1
npm run build:client
npm run build:server
npm run typecheck
npm run lint
npm run format:check
```

## Implementation notes

The target daemon public key remains the source-side identity anchor, while the source uses its long-term daemon key for each data channel. Creating a mapping persists an exact target-side grant over source public key, mapping ID, and port; deleting it revokes the grant before removing the source route. The Relay access token remains only a bandwidth gate. Relay locator and token never enter mappings or grants, so moving from B-hosted Relay to a VPS does not recreate either. The target never accepts a hostname, only `127.0.0.1:<port>`/`::1:<port>` semantics.

## Implementation evidence

Implemented across protocol, client, daemon, Service Proxy, Relay adapter, and Host Settings UI. The source route enforces the raw loopback TCP boundary for HTTP and WebSocket requests. Mapping persistence validates daemon public keys, serializes mutations, keeps memory unchanged on write failure, refuses to overwrite invalid state, and writes mode-`0600` files. Data channels use daemon-to-daemon E2EE, handshake/open timeouts, bounded byte-window flow control, and immediate teardown on failure.

Verification on 2026-08-20:

- 11 targeted files, 108 tests passed, including authenticated Relay, E2EE HTTP/SSE, WebSocket/HMR, unavailable target, persistence safety, local-only routing, daemon bootstrap isolation, dual-daemon E2E, custom remote HTTP connection enforcement, and pre-header client-disconnect cleanup;
- `npm run build:server`, repository-wide `npm run typecheck`, `npm run lint`, and `npm run format:check` passed;
- real Expo Web export passed;
- real browser list/create/remove flow was exercised against an isolated daemon before final safety gating;
- a real LAN A/B validation used isolated daemons without touching either production daemon: B reached A's authenticated AI Gateway and streamed a real SSE response; A reached B's temporary Web service over HTTP, chunked SSE, and WebSocket; the same hostname still worked after restarting the isolated source daemon;
- the LAN run exposed an HTTP connector bypass that dialed the source machine's metadata port instead of the remote Duplex; a one-shot custom HTTP Agent and a regression fixture with a deliberately closed local port now prevent recurrence;
- independent read-only review found endpoint syntax, non-loopback route access, lifecycle/durability hardening, and pre-header disconnect cleanup issues; all were fixed, covered by regression tests, and the focused re-review passed with no remaining actionable findings.

## Reopened after PR review

The first PR CI and independent review invalidated the closure evidence:

- both Linux and Windows full server jobs fail on an unhandled `RemoteByteStream` close error;
- the App drops `server_info.dataRelay`, so the normal UI cannot create a mapping;
- no committed Playwright E2E or desktop/compact screenshot evidence covers this UI;
- target-side source authorization and replay protection are incomplete;
- handshake disconnect cleanup, translations, accessibility and disconnected states still require work.

The earlier LAN validation remains useful transport evidence, but it cannot substitute for these missing product and security boundaries. Implemented after the reopen: long-term source E2EE identity and persisted target grants, a fresh target-issued handshake challenge that survives target restart, bounded pre-handshake buffering, connection session/sequence replay rejection, real App ingestion, disconnected-state/a11y/i18n fixes, live-target filtering, and compensating revoke/rollback handling for indeterminate grant responses. Source mappings are now the authorization desired state: loading mappings and a target coming online idempotently repair the exact target grant, so a lost source-create response cannot leave a permanent ungranted mapping; dedicated hook tests cover online repair, offline waiting, and visible repair failure. A dual-daemon Playwright flow now creates, reaches, persists across source restart, revokes, removes, and captures committed desktop/compact screenshots. Keep this Issue open until the replacement Linux/Windows CI passes and an independent re-review confirms the complete diff.
