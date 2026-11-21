---
kind: work
status: in_progress
current_unit: "List Pi background commands and stop one"
next_action: "Optional desktop spot-check after updating BySpace and the Pi extension"
must_hold: "Pi only; do not change Paseo; stop only the selected task in its owning session"
proof_gap: "No desktop UI run; the RPC path is proven end-to-end against a real Pi process"
---

User request: BySpace should recognize and manage tasks from our Pi Background Terminal extension.

| Path | Entry | Action | Expectation | Evidence | Result |
|---|---|---|---|---|---|
| Pi tasks | BySpace composer | Run two tasks and stop one | Both show; only the chosen shell stops | TestBackgroundTerminalRPC (env-gated, real Pi 1.6.0 CLI + extension): initial two running, after stop killed/running (PASS 0.91s); TestPiManageBackgroundTerminal: correlated response and read-only stop denial; pi-background-terminal.test.tsx: count and targeted stop | 通过 |
| Unsupported | BySpace composer | Open agent without extension | No task controls | TestBackgroundTerminalRPC returned null without the extension; composer regression checks that the control stays hidden | 通过 |

## Review fixes (2026-11-21)

Three-angle review (correctness, adversarial, ponytail) of the uncommitted change; every finding fixed:

- Availability gate removed: the bridge command is registered unconditionally, so the get_commands probe was dead code — a null roster is the unavailable signal. One fewer RPC per poll.
- Stop budget 10s (list stays 5s): the extension waits up to TASK_SETTLE_WAIT_MS=5s to confirm termination; a shared 5s deadline reported false failures.
- Bridge respond contract documented and bounded: decode inside try, 4s Promise.race around an async respond so a never-settling promise cannot wedge pi shutdown; undefined result means no listener.
- restoreSubagents is two-pass (index heads, then replay only the leaf branch), warns on open/scan/broken-chain failures instead of silently dropping, and replays linearly when the chain breaks. Restored rows keep their JSONL timestamp.
- Unknown task status normalizes to running (keeps the row visible and stoppable across extension upgrades); createdAt dropped from the wire schema (UI never used it).
- Cold/non-Pi agents answer an explicit error instead of a silent null; the composer hides a stale roster after 3 consecutive list failures and slows polling to 60s when unavailable.
- Subagent restore/Paseo-compat work is bundled intentionally: paused→canceled mirrors Node v1 (bywork/archive/v1/issues/071), transcript replay is promised by docs/agent-lifecycle.md, subagent-notify is the renamed extension event. Test file renamed subagents_compat_test.go (no Paseo content).
- Stray bin/ build artifacts gitignored; they were never tracked.
