---
kind: issue
title: On-demand daemon TCP forward
type: feature
status: closed
created: 2026-08-16
updated: 2026-08-16
---

# On-demand daemon TCP forward

## Goal

Let daemon A expose an ordinary loopback TCP listener that forwards each accepted connection through the existing E2EE Relay to daemon B, where daemon B dials only its own `127.0.0.1:<targetPort>` or `::1:<targetPort>`.

The first usable entry point is:

```bash
byspace tunnel <daemon-B-pairing-url> <target-port>
```

The command prints the actual local endpoint and remains in the foreground until interrupted. It prefers the same local port when available and otherwise uses an ephemeral loopback port. `--local-port` requests an exact local port.

Ownership: `codestable/epics/004-x-remote-tunnel/spec.md`.

## Confirmed scope correction

The user did not request a virtual IP that transparently covers every remote port. The required capability is explicit access to a selected remote daemon port at the lowest practical implementation and operational cost.

Therefore this Issue supersedes TUN, virtual-IP routing, HEV, a privileged helper, system-route changes, and password-bearing install/update work as prerequisites. Those experiments remain historical evidence only and receive no further product work unless the user explicitly reopens transparent virtual networking as a separate requirement.

## Implementation boundary

- Reuse the existing Relay v2 data connection and E2EE channel. Do not add a cloud service or terminate plaintext at Relay.
- Use the existing pairing URL as the Relay trust anchor, exactly like normal remote daemon control. A pairing holder is already a trusted daemon operator; do not invent a second daemon-password exchange for the data connection.
- Use one Relay/E2EE connection per accepted local TCP connection in v1. Do not add multiplexing until measured connection cost requires it.
- Bind the source listener only to `127.0.0.1`.
- Let the target daemon dial only loopback and the requested port. Do not accept arbitrary target hosts, LAN ranges, or public addresses.
- Forward bytes without HTTP parsing, HTML rewriting, Cookie handling, TLS termination, or WebSocket-specific behavior. HTTP, HTTPS, WebSocket, HMR, and arbitrary TCP work because the stream is byte-transparent.
- Preserve TCP half-close and propagate downstream backpressure. A DATA frame is acknowledged only after the destination socket accepts the write.
- Tie a forward to the creating daemon control session. Session close, explicit close, SIGINT/SIGTERM, daemon shutdown, or listener error must stop accepting new connections and close active streams.
- Advertise the capability only after daemon bootstrap and protocol dispatch are wired. No UI is required for this Issue.

## Acceptance contract

1. Protocol schemas accept open/close requests and old peers continue parsing server-info because the feature flag is optional.
2. The source manager binds loopback, prefers the requested/same port, falls back to an ephemeral port only when allowed, limits forwards/connections, and cleans up by owner.
3. The target bridge dials loopback only, preserves multi-megabyte byte identity and half-close, carries HTTP and WebSocket traffic unchanged, and applies bounded ACK-based backpressure.
4. A real local Relay Worker test proves the production Relay v2 + E2EE connector reaches the target bridge and returns a 1 MiB half-closed stream byte-for-byte.
5. `byspace tunnel` accepts a normal v2 pairing URL, prints the actual endpoint in human/JSON/YAML output, stays alive while the forward exists, and closes it on termination.
6. Focused tests, typecheck, lint, format, and diff checks pass. No broad local suite is required.

## Out of scope

- Virtual IPs, TUN/TAP, HEV, privileged helpers, routes, DNS, system proxy, firewall, Mihomo configuration, and administrator authorization.
- UDP, ICMP, remote LAN routing, P2P, transparent all-port interception, or automatic port discovery.
- Persistent detached mappings, multi-user sharing, UI, Browser Tab integration, and stream multiplexing.
- Reworking or deleting the existing single-daemon Browser Preview implementation.

## Current evidence

Implementation and validation are complete across protocol, daemon client, daemon bootstrap/dispatch, Relay data-channel routing, loopback TCP bridge/manager, CLI, security documentation, and user documentation.

Focused acceptance covers protocol compatibility, daemon client, CLI lifetime and structured output, listener ownership, open/owner-disconnect races, concurrent owner limits, target-side capacity, Relay-session reconnect during forward cleanup, byte identity, half-close, long and multibyte RESET teardown, and the production Relay v2 + E2EE carrier with a 1 MiB stream. `build:client`, `build:server`, CLI help, full typecheck, lint, format check, and `git diff --check` pass.

Independent review retracted its initial authentication concern after applying BySpace's existing pairing-link trust model. Its listener-open, RESET teardown, resumed-session cleanup race, and target-capacity findings were fixed with deterministic regressions. A later staged-only closure review found that accepted sockets lacked error ownership before bridge handoff, listening servers lacked persistent error ownership, automatic source-port selection did not fall back after permission denial, `--local-port 0` contradicted exact-port semantics, and YAML success output used the human branch. Those findings were fixed with focused regressions before the Epic commit. A fresh-context follow-up review found no release blocker; it retained only low-risk coverage gaps for direct `EACCES`/`EPERM` injection, standalone JSON parsing, and listener-error teardown with an active stream.

### Full-process acceptance (2026-08-16)

A source daemon ran as an independent process with an isolated `BYSPACE_HOME` and control port. A second daemon ran from the current checkout's Docker image in an OrbStack network namespace with no published container ports. The target HTTP/WebSocket and raw TCP services bound only the container's `127.0.0.1:24080` and `127.0.0.1:24081`; the host therefore could not reach them directly. Both daemons joined a real local Wrangler Relay Worker, and the ordinary v2 pairing URL was consumed through the real foreground `byspace tunnel` CLI.

The complete process path returned the container-only identity marker, preserved a 4 MiB HTTP echo (`sha256:fa227035c3a5d42b16af60734a3dc37732073e7fc1de1be233a7995d1024bcc8`), WebSocket text plus a 1 MiB binary frame (`sha256:3024be3deaf07444397c4dcc904f955fbe10ae33978c399120c634b22b60d012`) and close code `1000`, and an 8 MiB raw TCP response after client half-close (`sha256:d6c3e8f12e8595b67d86a72af75d2845338390583ba57caa8a9980150e46bcca`).

CLI `SIGINT` closed an active WebSocket one millisecond after the signal timestamp, and the source listener was absent at the immediate cleanup poll. Stopping daemon B closed an active stream; a new source connection failed closed after the 15-second Relay connection deadline while B was absent. After daemon B and its loopback service restarted, the same still-open forward succeeded in 58 ms without reopening the mapping.

A separate smoke used a fresh container daemon and the deployed Beta Relay offer at `relay-beta.byspace.zijieapi.de5.net:443` with TLS. Through the real CLI it returned the private target identity, preserved a 1 MiB HTTP echo (`sha256:b6ccf1e26fd4acd26619b70a033c311b773dab7f6cdcf88a3a8905ed43c3e217`), and preserved WebSocket text plus a 256 KiB binary frame (`sha256:97d0982151c84bae6f401bacd6bb70bebc4c6686673345029d7bb6eeb31d8da8`) with close code `1000`. Stable was not deployed or modified.

This proves a single-host, cross-network-namespace, independent-daemon full process chain. It does not prove physical multi-host networking, different operators or NATs, field proxies/Mihomo/firewalls, or real wide-area interruption behavior. Physical multi-host field validation is deferred by the user because a second machine is unavailable; it remains a later deployment-confidence gate and must not be inferred from this result.

## Closure (2026-08-16)

Closed with user authorization after the implementation, focused verification, independent-daemon full-process acceptance, and Beta Relay smoke met the Issue contract without reopening the superseded virtual-network scope.

Quality evidence at closure:

- **Functional suitability:** the real pairing URL and foreground CLI reached an unexposed daemon-B loopback service and preserved HTTP, WebSocket, multi-megabyte raw bytes, and TCP half-close.
- **Compatibility and information security:** the path required no administrator permission, TUN, route, DNS, proxy, firewall, or Mihomo changes; the source listener and target dial authority stayed loopback-only, and Relay payload stayed end-to-end encrypted.
- **Reliability and performance efficiency:** owner termination removed active streams and the listener, target loss failed within the bounded Relay deadline, the same forward recovered after target restart, and ACK-based flow control plus source/target capacity limits bound in-flight work.
- **Maintainability:** the implementation reuses Relay v2 and the existing E2EE channel, keeps HTTP and WebSocket out of the transport, and is covered by focused protocol, client, CLI, lifecycle, bridge, reconnect, and production-component integration tests plus independent review.

The stable result, constraints, validation state, and explicit exclusions are graduated into the owning Epic spec under its runtime model, control and compatibility contract, quality constraints, work status, and close conditions. Project Spec graduation remains the responsibility of a separately authorized Epic close.

Physical multi-host, distinct-NAT, and field proxy/Mihomo/firewall validation remains deferred by the user because a second machine is unavailable. It is a deployment-confidence gate, not evidence claimed by this Issue and not a hidden prerequisite for this closure.
