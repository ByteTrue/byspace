# Tasks

## 1. Parity ledger and safety baseline

- [x] 1.1 Add a provider parity ledger to docs/providers.md mapping each reference event/action at the pinned paseo commit to its Go handler and regression fixture; verify every requirement in this change has an owner and test reference.
- [x] 1.2 Make ACP, Codex, and OpenCode startup transactional with no fabricated session IDs; verify initialization/session-create failure tests return the native error and emit no usable session.
- [x] 1.3 Route files/both rewind only through provider-native rewind and remove the whole-workspace discard fallback; verify tests preserve unrelated tracked edits, untracked files, and a second session's changes, and verify unsupported rewind and chat-only rewind leave files untouched.
- [x] 1.4 Make shared cancellation/teardown settle pending tools and permissions with truthful turn outcomes; verify fake-provider cancellation and close tests contain no unresolved interactions.

## 2. Shared launch, capabilities, and native history

- [x] 2.1 Add user MCP server configuration to the shared launch input and server launch construction; verify launch-body tests preserve the configured servers before each provider's native forwarding task.
- [x] 2.2 Replace static or overstated capability claims with adapter and negotiated-session capabilities; verify tests cover unsupported archive, history import, settings, attachments, and subagents and cover dynamic updates.
- [x] 2.3 Implement native history import for each supported provider and explicit unsupported errors for the rest; verify provider-format fixtures import messages and metadata and update docs/providers.md with the support matrix.
- [x] 2.4 Implement native archive/unarchive where supported and truthful unsupported behavior elsewhere; verify per-provider operation tests and update the same support matrix.

## 3. OpenCode protocol parity

- [x] 3.1 Add OpenCode v1/v2 transport selection and native launch configuration, including MCP and system-prompt behavior; verify httptest servers receive version-correct session and prompt payloads.
- [x] 3.2 Consume OpenCode SSE for text, reasoning, tools, parts, status, usage, and errors; verify golden streams preserve native IDs, ordering, payloads, and terminal states.
- [x] 3.3 Implement SSE reconnect and gap resynchronization; verify interrupted-stream tests recover each missed event once and converge to authoritative turn state.
- [x] 3.4 Implement native permission replies and subagent enumeration/timeline data; verify httptest interaction tests and update docs/providers.md with supported OpenCode versions.
- [x] 3.5 Implement native steering, abort, and client message identity; verify accepted, rejected, and interrupted cases never create duplicate turns or false success.
- [x] 3.6 Implement session-scoped native revert; verify message revert payloads and the shared workspace-safety tests pass.

## 4. Generic ACP protocol parity

- [x] 4.1 Preserve native permission options and return exact option IDs; verify fake ACP requests with multiple options and update the ACP behavior documentation.
- [x] 4.2 Map all reference session-update families, including user chunks, plans, modes, configuration, session information, usage, and command inventory; verify golden update fixtures reach the correct client activity.
- [x] 4.3 Preserve tool raw input, output, diffs, locations, kinds, and terminal links with correct pending/terminal transitions; verify nonterminal updates never emit premature completion.
- [x] 4.4 Honor session-provided model/mode/config catalogs and native SetModel/SetMode/thinking outcomes; verify dynamic catalog and rejected-control tests.
- [x] 4.5 Implement native cancellation stop reasons, resume/load selection, and bounded close; verify cancellation cleanup, unsupported-load, and shutdown-timeout tests.
- [x] 4.6 Default ACP filesystem read/write to disabled with explicit opt-in; verify initialization payloads for default and enabled configurations and document the breaking default.
- [x] 4.7 Forward configured MCP servers through native ACP launch/session configuration; verify initialization fixtures preserve both user and BySpace-owned integrations.

## 5. Codex protocol parity

- [x] 5.1 Map Codex output, terminal, patch, MCP, web/image, plan, diff, retry, compaction, collaboration, and error event families; verify golden notifications preserve native content and ordering.
- [x] 5.2 Implement tool approvals and MCP elicitation; verify fake app-server requests receive the user's exact native decision.
- [x] 5.3 Preserve interrupted/failed turn outcomes and validate steering acknowledgements/client message IDs; verify rejection and interruption tests return no false success.
- [x] 5.4 Expose native Codex subagents from collaboration events; verify list and timeline fixtures and update docs/providers.md with native subagent support.
- [x] 5.5 Port custom prompt discovery, front matter, argument expansion, and out-of-band dispatch; verify filesystem fixtures cover metadata, $1-$9, $ARGUMENTS, and escaped dollars.
- [x] 5.6 Port native/on-disk skill discovery, deduplication, and skill input injection; verify app-server and workspace/home skill fixtures plus invocation payloads.
- [x] 5.7 Implement native compact and version-gated goal listing/control; verify commands execute out of band and literal slash text is not submitted as a normal turn.
- [x] 5.8 Forward configured MCP servers and replace the static model catalog with native/runtime data where available; verify launch and catalog tests.

## 6. Claude protocol parity

- [x] 6.1 Consume partial stream deltas for text, reasoning, and tool input; verify golden streams reconcile with final messages without duplicated content.
- [x] 6.2 Port native task started/updated/progress/notification handling as the subagent source of truth; verify task fixtures and remove dependence on Task-tool heuristics for those events.
- [x] 6.3 Map rich status, compaction, autonomous/background boundaries, and recovery events; verify state-transition fixtures and update docs/providers.md with supported Claude protocol behavior.
- [x] 6.4 Implement admitted steering and authoritative cancellation with client message identity; verify accepted, rejected, and cancelled cases settle all activity.
- [x] 6.5 Implement live model/thinking controls with native outcomes; verify mid-session changes affect subsequent turns and rejected changes remain unchanged.
- [x] 6.6 Implement native Claude file rewind and MCP launch forwarding; verify native rewind safety fixtures and initialization payloads.

## 7. Pi protocol parity

- [x] 7.1 Handle successful no-turn prompt responses, including agentInvoked:false, as their native terminal outcome; verify regression tests complete without waiting for a nonexistent turn.
- [x] 7.2 Add negotiated model input capabilities and enforce them before attachments are sent; verify text-only and image-capable model tests and update docs/providers.md.
- [x] 7.3 Use native abort queue clearing and truthful cancellation state; verify queued-prompt fixtures do not start after cancellation.
- [x] 7.4 Map manual/automatic compaction and automatic retry events and errors; verify golden event sequences and final session state.
- [x] 7.5 Preserve tool-result images and generic custom-message content and forward configured MCP servers; verify RPC fixtures retain rich payloads alongside BySpace-owned MCP/extensions.

## 8. Normalized background and subagent activity

- [x] 8.1 Extend provider SDK/wire models with normalized background identity, title/command, kind, status, progress, timestamps, and native navigation identifiers; verify protocol validation and client declaration builds pass.
- [x] 8.2 Publish initial snapshots and stable-ID live updates from supported providers; verify completion/failure updates deduplicate rows and unavailable output/progress fields remain absent.
- [x] 8.3 Connect managed-child and provider-native subagent targets to existing timeline APIs; verify navigation tests for both target kinds and update docs/agent-lifecycle.md where ownership changes.

## 9. Integration verification

- [x] 9.1 Run focused Go/Vitest/browser suites for every touched package, then npm run typecheck, npm run lint, npm run format:check, and npm run audit; record results and resolve regressions caused by this change.
- [x] 9.2 Run the documented real-provider compatibility matrix for installed Claude, Codex, OpenCode, Pi, and representative ACP agents; record vendor versions and any explicit unsupported capabilities without substituting mocks for this final check.
      Verified on 2026-11-22 with isolated homes and real Chrome: Pi 1.6.0 passed slash/no-turn, background start/stop, subagent timeline/archive, AskUser, and rewind. Claude Code 2.1.330 passed rewind, flat/nested subagents with background-notification replay, and Workflow report rendering. Codex 0.171.0 passed out-of-band /goal, rewind, native archive/unarchive, flat subagents, native model memory, native Plan, and rejected-plan steering. OpenCode 2.3.2 passed rewind, native import, and flat subagent metadata/timeline. ACP was explicitly excluded from this matrix by the user.
      This installation's Claude CLI exposes neither ExitPlanMode nor TaskCreate/TaskUpdate; Codex rejects update_plan; OpenCode big-pickle exposes no TodoWrite. Those cases assert the unavailable-tool behavior and skip with explicit reasons instead of fabricating provider success. The retired BySpace MCP-injection tool spec remains skipped by design.
