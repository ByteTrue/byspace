# Timeline sync

Agent chat delivery has two paths:

1. **Live stream** — `agent_stream` WebSocket messages for immediacy. These may be delta-shaped lifecycle updates.
2. **Authoritative history** — `fetch_agent_timeline_request` for correctness. This always returns full projected timeline items, never lifecycle deltas.

The invariant is:

> If the daemon has committed timeline rows for an agent, any connected client that opens or resumes that agent eventually displays every row through the daemon's current tail.

Tool output is bounded before it enters either delivery path. Canonical shell tool output is sliced
to 64 KiB, and the same bounded item is used for durable timeline rows and live stream events.
Provider history hydration applies the same rule so reopening an agent cannot restore an oversized
tool payload.

## Presence is not delivery

Client heartbeat reports presence:

- device type
- app visibility
- focused agent
- last activity time

Heartbeat is used for notification routing. It must not be used as a correctness gate for `agent_stream` delivery. A stale mobile focus heartbeat may affect whether the user gets notified; it must not make timeline rows disappear from the live stream.

## Catch-up is paged but complete

Large unbounded timeline responses can exceed relay frame limits, so catch-up uses bounded pages. Bounded does not mean partial.

Page limits are projected-item targets. A tool call lifecycle is one projected item even if it spans many source sequence numbers, and assistant/reasoning chunks are merged before counting. The response carries `seqStart`, `seqEnd`, `sourceSeqRanges`, and `collapsed` so clients can advance sequence cursors without rendering delta rows.

When the app fetches `direction: "after"` and the daemon responds with `hasNewer: true`, the app must immediately fetch the next page from `endCursor`. The catch-up is complete only when `hasNewer: false`.

Initialization timeouts guard lack of catch-up progress, not the full multi-page sync. A successful page that queues the next `after` page refreshes the watchdog.

The first load of an agent without a local cursor is different: it fetches a bounded latest tail page. Older history remains user-driven by scrolling upward.

## Durable item anchors

Provider message IDs are not guaranteed for every displayed item. BySpace-generated system errors are one example. Rendered item indices are not durable either because pagination and projection can merge source rows.

Actions that address a point in chat history, such as Fork, use the daemon timeline `epoch` plus the projected item's `seqEnd`. The app carries that position on the rendered assistant item for both live and fetched history. When adjacent projected chunks merge, the merged item retains the newer chunk's position.

The daemon validates that the epoch is current and the exact source sequence still exists before slicing rows. It slices before projection so later lifecycle updates cannot leak into the selected context.

## Resume behavior

When a client resumes with a known cursor, it catches up after that cursor to completion. It does not replace the view with a latest tail page, because tail pagination can skip the middle of a long background run.

When a client resumes without a cursor, it fetches the latest tail page.

## Runtime-independent retained history

Idle runtime collection and Timeline ownership are separate. Collecting a Provider runtime keeps the
daemon's canonical in-memory Timeline replica. A later `fetch_agent_timeline_request` reads that replica
and combines it with the stored agent snapshot without starting the Provider; sending a prompt or any
other Provider mutation still resumes the durable Provider session normally.

This fast path deliberately ends at daemon process lifetime. After daemon restart, no in-memory replica
exists, so the first history read falls back to Provider resume and hydration. Persisting a second
server-side Timeline replica is not part of this optimization.

## Client replica lifetime

The host runtime owns each session replica and its timeline sync owner for as long as the host remains
registered. React providers only report browser activation and UI integrations to that owner;
mounting or unmounting a provider must not create the owner, arbitrate responses, or clear the
replica. A provider can remount during Fast Refresh or ordinary UI recomposition while the runtime
still owns the same directory snapshot, timeline cursors, and in-flight request metadata.

Removing the host from the registry is the destructive boundary: it stops the runtime, rejects and
clears that owner's pending initialization watchdogs, and clears the session and host-scoped setup
state together.

## Selective and legacy delivery

The app chooses one delivery policy from `server_info.features.selectiveAgentTimeline`:

- Selective daemons receive every agent visible in any pane plus the most recently viewed hidden
  agents, up to five subscribed agents. Visible agents always win: if more than five are visible,
  they all remain subscribed and no hidden agent does. Switching and app backgrounding preserve
  this connection-scoped hot set. Re-showing a retained timeline still starts an immediate
  authoritative catch-up and bypasses identical in-flight request deduplication, because retained
  membership is not proof that a suspended browser or transport delivered every live event.
  Losing window keyboard focus does not make a selected pane invisible. Disconnecting clears hidden
  hot agents; reconnect restores the currently visible set before authoritative catch-up. Revisiting
  an evicted retained timeline displays its cached state immediately while authoritative catch-up
  advances it to the current tail.
- Legacy daemons keep globally streaming agent timelines. Visibility still triggers the existing
  authoritative catch-up, but the app does not issue selective-subscription RPCs.

`agent-timeline-sync-owner.ts` owns request issuance and response application. It reuses
`viewed-timeline-sync.ts` for visibility membership and forward catch-up policy; downstream reducers
do not branch on daemon version.

## Response arbitration

Each host has one timeline sync owner. Initialization, resume/focus repair, gap recovery, explicit
refreshes, rewind/reload repair, and older pagination all pass through it. `requestId` only correlates
a response with its request; request issuance order does not define snapshot freshness because a
request that started earlier may take its daemon snapshot later. A response carrying a protocol
`error` is a failed request: it applies no replica or pagination state, cannot mark readiness, and
enters the same retry path as a transport failure.

The owner keeps independent `forward` and `older` lanes. Every forward control intent has one stable
identity across all of its `after` pages; a later focus/resume intent can supersede it without making
an older continuation current again. Explicit visibility repair bypasses equivalent-request
deduplication on every page, not only the first page. A current forward response alone may complete
initialization or visibility readiness. An earlier response from the same connection may still
contribute canonical rows when the reducer proves they extend the current epoch and sequence range,
but it cannot complete a newer control intent or overwrite pagination metadata. Fully covered units
in an overlapping same-epoch page are not replayed, while boundary-spanning projected units remain
eligible for canonical reconciliation. Older pages may extend `startSeq` and `hasOlder`; they never
complete forward readiness or move `endSeq` backward. Once an accepted response changes the daemon
timeline epoch, responses issued before that rollover cannot replace it; a current rejected control
response is retried rather than treated as ready. Same-epoch gap resets remain authoritative while
their request cursor is still the active replica boundary, and become ordinary overlap repair after
that boundary advances. Responses from a previous host connection epoch are ignored.

Before applying an authoritative page, the owner flushes queued live events for that agent and then
uses the existing canonical reducer. A live row from a different daemon timeline epoch can switch
the visible replica directly only when it is sequence 1. If the first observed row is later than
sequence 1, the owner holds the current replica and requests authoritative repair; an old-epoch page
already in flight cannot overwrite that observation. This keeps low-latency live presentation and
authoritative repair on one serialized replica boundary without treating either path as globally
newer by arrival time.

## Projected pages reconcile with live presentation

A projected page is canonical state, not a sequence of live deltas. One projected item can overlap
rows already received live—for example, a tool call retained at its original display position while
its completion advances `seqEnd`, followed by a merged assistant message. The app uses
`sourceSeqRanges` to replace overlapping assistant and reasoning projections before applying the
remaining page through the existing stream reducer. It must not append full projected text to a
live prefix.

Optimistic user prompts occupy stable timeline slots. Catch-up never extracts, delays, or reinserts
them. A canonical user row replaces its matching slot in place; an unmatched prompt stays exactly
where the user submitted it. Other canonical rows are applied after the already-present timeline
instead of relocating visible user messages around newly fetched history.

Canonical submitted user rows carry the provider's `messageId` and BySpace's optional
`clientMessageId`. Clients reconcile optimistic prompts by `clientMessageId`. Content matching is
limited to the dated compatibility path for daemon timelines created before that field existed.

## Relevant code

- Server live stream forwarding: `packages/server/src/server/session.ts`
- App sync planning: `packages/app/src/timeline/timeline-sync-plan.ts`
- App timeline owner: `packages/app/src/timeline/agent-timeline-sync-owner.ts`
- App visibility membership/catch-up policy: `packages/app/src/timeline/viewed-timeline-sync.ts`
- App stream/timeline reducer: `packages/app/src/timeline/session-stream-reducers.ts`
- Host runtime integration: `packages/app/src/runtime/directory-sync/index.ts`
- React activation wiring: `packages/app/src/contexts/session-context.tsx`
