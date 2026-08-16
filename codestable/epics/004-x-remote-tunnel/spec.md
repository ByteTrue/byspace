---
kind: epic
title: Remote Port Access
status: closed
created: 2026-08-13
updated: 2026-08-16
---

# Remote Port Access

## What this changes

A user running daemon A must be able to access a selected TCP port on daemon B's own localhost with minimal setup and no administrator permission. The product capability is an explicit local TCP forward, not a virtual IP that automatically covers every remote port.

```text
curl/browser/client -> daemon A 127.0.0.1:<localPort>
                    -> one E2EE Relay stream per TCP connection
                    -> daemon B 127.0.0.1:<targetPort>
                    -> remote localhost service
```

The initial entry point is a foreground CLI command:

```bash
byspace tunnel <daemon-B-pairing-url> <target-port>
```

It prints the actual loopback endpoint. When the same local port is free it is preferred; otherwise BySpace selects an ephemeral local port. `--local-port` requests an exact source port.

Related current truth: `codestable/spec/index.md`. This Epic was closed with user authorization after the selected-port capability and available acceptance gates completed.

## Confirmed product boundary

The user's requirement is access to another daemon's ports, such as APIs and web development servers, at the lowest practical cost. It does not include transparent all-port interception or a stable virtual-IP identity.

This correction freezes the prior virtual-IP/TUN direction:

- TUN, HEV, privileged helpers, exact routes, address pools, Developer ID helper updates, and repeated administrator authorization are not prerequisites for Remote Port Access.
- The existing native-helper source and Issues 001/002 remain historical feasibility evidence. No further product work should be spent on them unless transparent virtual networking is separately requested later.
- BySpace does not change default routes, DNS, system proxy, firewall, or Mihomo configuration. The Relay connection simply follows the machine's existing network path.

## Runtime model

### Source daemon

- Accept an open request containing daemon B's normal Relay v2 pairing offer and target port.
- Bind only `127.0.0.1`; never expose the local listener to LAN or public interfaces.
- For each accepted local TCP connection, open one existing Relay v2 data connection to daemon B and establish the normal end-to-end encrypted channel.
- Send a small encrypted `OPEN` control frame containing only the target port, then forward raw bytes.
- Tie the listener and all active streams to the control session that created the forward. Explicit close, session disconnect, CLI termination, or daemon shutdown cleans them up.

### Target daemon

- Route only Relay connection IDs reserved for Remote TCP Forward into the forwarding bridge; normal client Relay connections keep their existing WebSocket-server path.
- Dial only local loopback, trying `127.0.0.1` and then `::1` for the requested port.
- Never accept a target hostname, public address, LAN address, Unix path, or arbitrary command from the source.
- Return an encrypted `OPENED` or bounded error result before stream data begins.

### Stream semantics

- Payload bytes are not parsed or rewritten. HTTP, HTTPS, WebSocket, HMR, databases, and other TCP protocols share the same path.
- FIN is represented explicitly so TCP half-close survives the Relay hop.
- DATA frames are at most 64 KiB. The sender pauses its socket and waits for an ACK; the receiver sends that ACK only after the destination socket's write callback completes. This supplies bounded backpressure without inventing a multiplexing protocol.
- The first version uses one Relay/E2EE data connection per accepted TCP connection. Connection pooling and multiplexing require measured evidence before they are added.
- Per-forward and per-daemon limits bound listeners and active streams; invalid framing, excess payloads, timeout, Relay loss, or destination failure close only the affected stream/forward.

## Control and compatibility

The daemon WebSocket protocol adds dotted `remote.tcp.forward.open.request/response` and `remote.tcp.forward.close.request/response` messages. The daemon advertises optional `server_info.features.remoteTcpForward`; old clients still parse the new server info, and old daemons fail a new request cleanly rather than receiving a fallback implementation.

The CLI accepts the same v2 pairing URL already used to pair a browser/client with daemon B. It uses the local daemon's normal authenticated control connection, prints the actual endpoint in table or JSON form, stays in the foreground, and closes the forward on SIGINT/SIGTERM.

## Quality constraints

- **Functional suitability:** requests to the printed local endpoint must reach daemon B's same selected loopback port and preserve raw TCP behavior, including half-close.
- **Compatibility:** no administrator permission, TUN, route, DNS, proxy, firewall, or Mihomo changes. The carrier may naturally traverse Mihomo according to existing system rules.
- **Reliability:** listener ownership, stream limits, connection timeout, backpressure, daemon-control disconnect, Relay disconnect, and target-socket failure must converge without orphan listeners or streams.
- **Information security:** Relay payload remains end-to-end encrypted. The target authority is restricted to daemon B's loopback and one requested port; the source listener is loopback-only.
- **Maintainability:** reuse the existing Relay v2 and E2EE channel. Do not add a second cloud transport, a TCP/IP stack, HTTP rewriting, or speculative multiplexing.
- **Performance efficiency:** accept one Relay connection per local TCP connection for the first version; optimize only after real usage identifies connection setup or throughput as a bottleneck.

## Work closure

- [x] `issues/003-x-on-demand-tcp-forward.md` - delivered and closed after minimal protocol, daemon bridge/manager, Relay/E2EE connector, foreground CLI, focused acceptance, independent-daemon host/OrbStack acceptance, Beta Relay smoke, and review completed the selected-port access slice.
- [x] `issues/001-x-virtual-ip-tunnel-penetration.md` - closed as a superseded feasibility experiment; evidence is retained, but transparent virtual networking is not a delivered feature or prerequisite.
- [x] `issues/002-x-macos-privileged-helper-library.md` - closed as a superseded implementation experiment; source/evidence is retained, but the helper is not released, advertised, or required.

## Out of scope

- Transparent virtual IP, all-port capture, TUN/TAP, HEV, privileged helper, system routes, UDP, ICMP, LAN/subnet forwarding, P2P, internal DNS, and port discovery.
- Persistent detached mappings, multiplexing, connection pools, public listener addresses, and shared multi-user forwarding.
- Browser Tab UI or Ports UI in this slice.
- Reworking or deleting the single-daemon Browser Preview/Gateway implementation.

## Epic close conditions

- The CLI-to-daemon control path and real Relay v2 + E2EE data path pass focused tests for byte identity, HTTP, WebSocket, half-close, backpressure, fallback local-port allocation, and cleanup.
- A source daemon process and an unexposed OrbStack target daemon pass the real pairing URL and foreground CLI path through a local Relay, including interruption, recovery, active-stream cleanup, and listener cleanup.
- A deployed Beta Relay smoke passes container-private HTTP and WebSocket traffic over TLS without changing Stable.
- Protocol compatibility, typecheck, lint, format, focused tests, and the independent-daemon acceptance pass.
- User documentation explains the pairing URL, actual local endpoint, foreground lifecycle, loopback-only authority, E2EE boundary, and absence of administrator requirements.
- The superseded TUN/helper work is clearly classified as historical evidence rather than an active prerequisite.
- Physical multi-host field validation remains explicitly deferred and cannot be inferred from the single-host cross-network-namespace result.

**Project-spec graduation:** the explicit loopback TCP-forward contract, Relay E2EE path, source/target authority constraints, lifecycle ownership, CLI behavior, exclusions, and physical-field-validation boundary are recorded in `codestable/spec/index.md` under “远程端口访问”.

**Vision check:** this is a narrower delivery mechanism for remote development-service access, not a commitment to transparent virtual networking.

## Closure (2026-08-16)

Closed with user authorization after the corrected product goal was delivered: daemon A can expose a selected daemon-B loopback port through a foreground, loopback-only, E2EE Relay TCP forward without administrator permission or system networking changes.

Issue disposition is explicit: Issue 003 completed the supported capability; Issues 001 and 002 closed as superseded experiments rather than completed TUN/helper products. Their component hashes, root-boundary designs, and unresolved signing/upgrade gates remain historical evidence and do not expand the supported surface.

The quality conclusion is supported by protocol compatibility tests, bounded framing/backpressure and capacity limits, pre-bridge socket and persistent-listener error ownership, owner/Relay/target lifecycle regressions, independent review, a production-component Relay/E2EE integration, the independent source-daemon plus unexposed OrbStack target full-process acceptance, and a deployed Beta Relay smoke. Repository typecheck, lint, format, and diff gates pass.

Stable product truth has graduated to `codestable/spec/index.md`. Physical multi-host, distinct-NAT, and field proxy/Mihomo/firewall validation remains explicitly deferred because a second machine is unavailable; it is a deployment-confidence limitation, not a claim of completion evidence and not a reason to retain this Epic as active.

No follow-up Issue is created. Any future persistent mappings, multiplexing, UI, or transparent virtual-networking work requires a new explicit requirement and separately scoped Issue.
