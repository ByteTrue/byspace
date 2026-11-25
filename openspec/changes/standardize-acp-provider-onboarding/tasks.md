# Tasks

## 1. Canonical ACP configuration writer

- [x] 1.1 Add offline `provider add acp` argument parsing and canonical-entry construction; verify focused CLI tests cover the agy example, exact argv, invalid IDs/labels/argv, built-in IDs, and identical reruns.
- [x] 1.2 Persist through the existing atomic store path while preserving siblings and surfacing write errors; verify focused store/CLI tests cover conflicting entries, unrelated settings, failed writes, and the exact saved agy entry.

## 2. Shared ACP conformance

- [x] 2.1 Refactor generic ACP startup into shared staged launch/initialize/session creation without changing normal session behavior; verify existing ACP tests and new stage-error tests pass.
- [x] 2.2 Implement the baseline `provider check <id>` runner and stable CLI report with bounded prompts, output/completion detection, dependent skips, non-zero failures, and process cleanup; verify a cross-platform fake ACP process covers pass and each baseline failure stage.
- [x] 2.3 Add negotiated image, native continuation, and model/mode/thinking catalog checks with PASS/FAIL/SKIP results; verify fake ACP fixtures cover advertised success, advertised failure, and unadvertised skips.
- [x] 2.4 Verify conformance is isolated by testing that passing and failing runs leave the BySpace agent/workspace collections unchanged.

## 3. Copy-prompt onboarding and documentation

- [x] 3.1 Update the copied prompt and embedded adapter guide to require canonical writing, daemon diagnostic/reload, and `provider check`; verify focused resource/RPC tests assert the absolute guide path and new command sequence while the single Copy prompt action remains unchanged.
- [x] 3.2 Correct the ACP reference defaults and unsupported `order` guidance, and update `docs/custom-providers.md` plus the provider onboarding link with the agy writer/check example; verify the documented commands match CLI usage and resource tests pass.

## 4. Integration verification

- [x] 4.1 Run `npm run format`, `npm run typecheck`, and `npm run lint`; resolve and rerun any reported failures.
- [x] 4.2 Exercise the complete flow against a real authenticated agy installation: canonical add, daemon diagnostic/reload, baseline check, and every capability agy advertises; record PASS/FAIL/SKIP results and investigate failures before completion.
  - Real agy result: launch, initialize, session, prompt, output, completion, image, continuation, mode, and thinking PASS; model FAIL because agy returns no fresh negotiated-state evidence after `session/set_model`. The check intentionally remains strict rather than treating the setter's optimistic local value as proof.
- [x] 4.3 Run `npm run audit` with browser checks when the dev daemon is available, otherwise `npm run audit -- --no-browser`; verify Go, parity, and applicable browser checks pass.

## Workflow follow-up

- Archive the change only after implementation review and real-provider acceptance are complete.
- Verify the archived result and the unaffected existing ACP provider configurations.
