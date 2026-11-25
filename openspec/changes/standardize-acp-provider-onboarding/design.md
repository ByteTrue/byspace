# Design

## Context

Generic ACP providers already launch from declarative `agents.providers` entries through `providers.StartACPSession`; standard integrations need no provider-specific Go or TypeScript adapter. The current onboarding agent nevertheless authors the JSON itself and chooses its own smoke test.

The CLI provider group currently supports daemon-backed list/model/diagnostic commands. The store already deep-merges provider patches and atomically writes `config.json`, but its save API does not surface the final atomic-write error. Existing global validation intentionally accepts hand-written and advanced configurations more permissively than the canonical onboarding format.

## Goals / Non-Goals

**Goals:**

- One BySpace-owned writer for the minimal generic ACP entry.
- One executable acceptance path with deterministic check names and explicit PASS/FAIL/SKIP results.
- Exact reuse of generic ACP launch, negotiation, prompt, catalog, and continuation behavior.
- Copy-prompt onboarding that remains independent of built-in provider presets.

**Non-Goals:**

- A settings form, preset catalog, new WebSocket RPC, or provider-specific agy integration.
- Equal model quality, feature support, or behavior across different ACP implementations.
- Canonical flags for every advanced field (`env`, client-capability overrides, or static model catalogs). Advanced hand-written entries remain supported and can use the conformance command.
- Tightening validation for every existing/manual configuration or changing ACP runtime negotiation.
- Generically forcing model-dependent tool calls or permission prompts. ACP does not negotiate a deterministic prompt that will trigger them.

## Decisions

### 1. Add a narrow canonical writer

Use:

`byspace provider add acp --id agy --label "Antigravity" -- agy acp`

Everything after `--` is the stored argv. The writer emits only `extends`, `label`, and `command`; it does not infer models, authenticate, or add optional fields. Validate the existing provider-ID pattern, require a non-empty label and argv, reject built-in IDs, and reject empty argv elements.

An identical existing canonical entry is a successful no-op. Any other entry at the same ID is a conflict and remains untouched. No implicit merge, `--force`, or replacement mode is added.

Alternative: a UI form or restored catalog would make common cases deterministic, but both were rejected during scope selection. Letting the agent emit JSON for the writer would preserve the field-selection inconsistency this change removes.

### 2. Reuse store persistence and surface write failures

Route the writer through the existing store merge/atomic-save path so sibling providers, unknown fields, and nested `agents.providers` persistence retain one implementation. Extend that path to return write failures to the CLI rather than printing success after an ignored error. Do not duplicate config-file manipulation in the CLI.

The strict writer validates only its own input. Global load/write validation is unchanged in this change because making it stricter would alter existing manual-config behavior beyond onboarding.

### 3. Run conformance in an isolated CLI-owned session

`byspace provider check <id>` resolves the saved provider through the existing provider-spec path, starts the generic ACP implementation in a temporary working directory, and never creates a BySpace agent or workspace. It inherits authentication environment, applies configured provider environment when present, bounds each stage with a context, and closes spawned processes on every result.

Keep `add` and `check` off the current unconditional daemon WebSocket path. Existing `ls`, `models`, and `diagnostic` behavior remains unchanged. The onboarding recipe still runs daemon diagnostic/reload so a daemon-specific PATH problem is not hidden by a successful CLI-launched check.

Alternative: a daemon-hosted conformance RPC would exercise the daemon environment directly but adds wire schemas, long-running RPC lifetime, session cleanup, and authorization concerns without improving the shared protocol checks.

### 4. Share staged startup instead of duplicating ACP

Refactor ACP startup internally so the existing session constructor and the conformance runner execute the same launch, initialize, and session/new operations. The existing constructor keeps its public behavior; the conformance path receives structured stage errors instead of parsing error strings.

Use the existing ACP event stream to require assistant output and a terminal stop reason. Return a report ordered by stable check IDs. A prerequisite failure marks that check FAIL and remaining dependent checks SKIP; it never produces a partial success.

### 5. Derive optional checks from negotiated state

Run the common baseline first, then select:

- `prompt.image` when `agentCapabilities.promptCapabilities.image` is explicitly true, using an embedded tiny PNG plus text.
- `session.continuation` when load or resume is advertised: close the initial client, reopen the returned native session handle through the generic resume selection, and complete another text turn.
- Model, mode, or thinking selection only when the session returned a corresponding catalog with an alternative to select. Select the alternative and verify the resulting negotiated state; restore is unnecessary because the session is disposable.

Absent capabilities report SKIP. Advertised capabilities that fail report FAIL. Permission and arbitrary tool execution are not synthesized from prompts because model discretion would make the result nondeterministic.

### 6. Keep Copy prompt as discovery, not implementation

Update the copied prompt and embedded guide so the coding agent discovers official ACP invocation/authentication, calls the canonical writer, reloads the daemon, and runs `provider check`. Keep the existing settings action and resource path unchanged.

Correct the reference to filesystem false / terminal true defaults and remove the unsupported `order` field. Use agy only as a worked generic example with `agy acp`; do not add an agy preset or runtime branch.

## Risks / Trade-offs

- **A live model response can be slow or nondeterministic** → Use fixed minimal prompts, per-stage deadlines, and report protocol failures rather than judging answer quality.
- **CLI and daemon PATH can differ** → Keep daemon diagnostic and reload as mandatory onboarding steps; conformance alone is not a daemon-environment proof.
- **Native CLIs may retain their own session history** → Close all spawned sessions/processes and document that BySpace state is untouched, not that the provider erases native history.
- **Advanced manual entries can still have different optional fields** → Limit canonical output to standard minimal ACP configuration; apply the same conformance checks to advanced entries without claiming canonical writer coverage for them.
- **Catalog selection can have provider side effects** → Run it only in the disposable conformance session and never in a user agent session.

## Migration Plan

Existing provider entries and runtime behavior remain unchanged. The new commands are additive. Updated embedded onboarding resources refresh through the existing materialization path; no data migration is needed. Rollback removes the commands and prompt changes without altering saved provider configuration.
