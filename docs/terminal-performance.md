# Terminal performance

How terminal output stays low-latency, what the invariants are, and how to measure before/after any change to the pipeline. Read this before touching anything under `packages/server/src/terminal/` or `packages/app/src/terminal/runtime/`.

## The pipeline

```
pty (node-pty, forked worker process)
  → headless xterm parse (worker, snapshot fidelity)
  → TerminalOutputCoalescer (worker, ≤1 IPC message per 5ms per terminal)
  → process.send IPC → daemon main process
  → TerminalOutputCoalescer (per client stream, terminal-session-controller.ts)
  → binary ws frame (2-byte header + raw bytes)
  → client decode (daemon-client.ts) → stream router → emulator runtime
  → xterm.write (back-to-back; xterm batches internally)
```

Terminal frames share the daemon main event loop with all agent traffic. The `eventLoopDelay` block in the `ws_runtime_metrics` log line (every 30s in `daemon.log`) is the ground truth for "the daemon is busy" — p99/max there directly bound worst-case terminal frame delay.

## Invariants (the easy-to-break ones)

- **Coalescers are leading+trailing throttles.** The first chunk after an idle window flushes immediately (synchronously); only sustained bursts wait for the trailing timer. That timer targets the **remaining** part of the original 5ms window rather than starting another 5ms delay from the latest chunk. Reverting to trailing-only adds a full window to every keystroke echo; restarting a full delay during a burst can stretch the intended window toward 10ms.
- **Output coalescing happens in the worker, before IPC.** One `process.send` per pty chunk was a main-loop flood under build output. Non-output messages (snapshot/snapshotReady/titleChange/exit) must flush the coalescer first so ordering is preserved.
- **Coalesced output carries the LAST chunk's revision.** Snapshot replay dedup (`replayTerminalOutputAfterSnapshot`) skips buffered output with `revision <= replayRevision`; a merged batch with a lower revision would be wrongly skipped (lost output).
- **The input-mode tracker runs once per process boundary, not per hop.** The worker owns the authoritative tracker; the daemon caches the replay preamble from `getTerminalState` responses and `snapshotReady` messages. Do not reintroduce a per-chunk `feed()` on the daemon main loop.
- **Bracketed paste is part of authoritative input-mode state, with a Windows fallback.** Track `CSI ? 2004 h/l` alongside application cursor keys and replay it after every snapshot reset. If a snapshot restores cells but not mode 2004, xterm turns a multiline paste into separate submitted lines even though rendering and transport latency remain healthy. On Windows, ConPTY may omit the application's mode-2004 output, so browser clipboard text containing a line break must be normalized, escape-sanitized, and force-framed as one bracketed block even when xterm reports the mode off; other platforms and single-line text continue to follow xterm's live mode.
- **Browser clipboard images cross the existing file-upload boundary.** If a paste event contains PNG/JPEG/GIF/WebP data, upload it through the existing `file.upload.request` path and force-paste the daemon-local path as one bracketed block, regardless of accompanying text or xterm mode 2004. This is client behavior over the file-upload RPC available since v0.1.0, so it needs no Terminal-specific daemon capability. Never send base64 through the PTY or read the daemon machine's clipboard. Serialize repeated asynchronous image pastes, but keep ordinary terminal input immediate. On Windows, treat Pi's `Alt+V` as an image-aware alias only when the clipboard contains a supported image; otherwise forward the original chord.
- **Snapshot catch-up is backpressure-gated.** A stream falls back to a full snapshot only when `outputBytesSinceSnapshot > MAX_TERMINAL_OUTPUT_FRAME_BYTES` (256KB) **and** the client transport reports `bufferedAmount > MAX_CLIENT_BUFFERED_BYTES` (4MB). A client that keeps draining streams continuously, no matter how much output is produced. Before this gate existed, every 256KB of build output dropped a frame and forced a full JSON cell-grid snapshot (~200k objects across IPC) — the historical source of spiky lag and GC hitches.
- **Client output writes are not serialized per frame.** The emulator runtime drains contiguous plain writes straight into xterm (which buffers internally). Only barrier ops (`clear`, `snapshot`, `suppressInput` writes) wait — behind a zero-length sentinel write — so resets can't interleave with in-flight output.

## Measuring

- **Node-only benchmark (fast iteration, server pipeline):** `npx tsx scripts/benchmark-terminal-latency.ts`. Boots an isolated daemon (fresh `BYSPACE_HOME`, random port — never 6777), measures echo latency percentiles, burst jitter, and snapshot counts under ramped mock-agent load. Writes JSON to `/tmp/byspace-terminal-bench/`. Healthy numbers (2026-06): echo p50 ~2.3ms, p95 ~3.3ms, a 2MB burst fully streamed with `snap=0`.
- **Browser perf specs (user-perceived path):** gated behind `BYSPACE_TERMINAL_PERF_E2E=1` —
  `packages/app/e2e/terminal-performance.spec.ts` and `packages/app/e2e/terminal-keystroke-stress.spec.ts` (per-stage keydown→xterm-commit breakdown under mock-agent load). Healthy: keydown→commit p50 ~18ms under 600-key burst.
- **Production:** grep `daemon.log` for `ws_runtime_metrics` and read `eventLoopDelay` + `bufferedAmount`.
- **Cross-product Direct baseline:** `packages/app/e2e/terminal-direct-baseline.spec.ts` uses the shared deterministic workload in `packages/app/e2e/fixtures/terminal-direct-workload.mjs`. Five same-machine/same-Chromium runs on 2026-07-21 did not reproduce a BySpace raw-performance deficit: BySpace beat Orca Web Direct on idle and loaded input p95, synchronized TUI redraw, 50k-line parse, and resize. Evidence and machine-readable medians live under `.cs/issues/2026/07/21/open-terminal-direct-baseline/`. Do not introduce a scheduler or transport split from subjective feel alone; first reproduce the failing semantic or visual dimension.

## What is portable from Orca

Orca (`d9d939a33b58`, reviewed 2026-07) has **two** terminal transports:

- Its Electron-local path uses native PTY IPC, a renderer-side time-budgeted output scheduler, parse-completion ACKs, producer pause/resume, active-pane priority, and an input-correlated small-redraw bypass. The browser cannot copy the native producer controls directly.
- Its paired Web client is directly comparable to BySpace. The server serves the Web app, and `WebRuntimeClient.subscribe()` gives `terminal.multiplex` a dedicated E2EE WebSocket. All panes for one runtime share that subscription and use a binary stream with 32-bit stream IDs, output sequence high-waters, snapshot frames, input/resize frames, and ACK frames. The server batches for 5ms/64KB, caps frames at 48KB, allows 512KB in flight per stream and 2MB per connection, retains at most 256KB while stalled, then sends an authoritative snapshot before the retained tail. The client detects sequence gaps and requests a recovery snapshot.

The Orca Web ACK is sent after decrypt/decode and synchronous routing into the renderer output processor, **not** after the `xterm.write` callback. It is transport-consumption credit, unlike the Electron-local parse-completion ACK. Preserve that distinction when adapting it.

BySpace already has the other portable foundations: imperative xterm writes outside React state, WebGL with DOM fallback, worker-side headless snapshots, leading-edge output delivery, binary terminal slots, per-client coalescing, output revisions, and snapshot recovery for slow transports. Prefer extending those mechanisms rather than adding a second Orca-style renderer scheduler.

Portable follow-ups remain hypotheses, not the current implementation queue. Profile the affected Direct or Relay scenario before selecting one:

1. Evaluate a dedicated terminal WebSocket/capability, multiplexing the existing terminal slots on it. This isolates terminal delivery from large agent/control frames and is the closest direct adaptation of Orca Web; it does not by itself remove app-main-thread JSON parse/render stalls.
2. Add backward-compatible client credit for Relay, where server-side `bufferedAmount` is unavailable. Receipt-level ACKs like Orca provide transport pressure; xterm-commit ACKs provide stronger parser pressure but must remain aggregated and non-serializing. Feed either into BySpace's existing snapshot/revision recovery rather than inventing another recovery system.
3. Carry an optional output sequence/revision on the negotiated stream so the client can detect gaps and request an authoritative snapshot, matching Orca's self-healing behavior.
4. Stop subscribing and rendering hidden retained terminal tabs; restore them through the existing authoritative snapshot path when visible.
5. Coalesce ResizeObserver-driven fits into one animation frame and reject transient near-zero layouts before they resize the PTY.
6. Do not copy Orca Web's 8ms typed-input debounce or trailing-only 5ms output batcher: BySpace's immediate input send and leading-edge output coalescer are lower-latency. Add Orca's input-correlated bypass only if browser stress measurements show a remaining tail.

## Known remaining contention (follow-up candidates)

- A single large `agent_stream` message (e.g. a 250KB diff payload) measurably delays terminal echo (~100ms-class dips) — cost is split between daemon serialization and app-side parse/render on the shared browser main thread.
- Relay-attached clients pay pure-JS tweetnacl encryption + base64 per frame on the daemon main loop (`packages/relay/src/encrypted-channel.ts`).
- `sendToClient` re-stringifies session messages per socket; only matters for multi-socket connections.
