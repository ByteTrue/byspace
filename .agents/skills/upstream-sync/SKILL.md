---
name: upstream-sync
description: Rebuild BySpace from a frozen getpaseo/paseo release snapshot while preserving its clean orphan history, Web-only product boundary, BySpace identity, package distribution, and Stable/Beta channels. Use whenever the user asks to check, inspect, compare, review, update, pull, merge, sync, or adopt upstream/Paseo changes or a new Paseo release.
---

# BySpace upstream sync

Import a complete release snapshot; never revive the old per-commit deep-fork workflow.

## Read first

Read these files completely:

1. `docs/upstream-sync.md`
2. `docs/release-engineering.md`
3. `docs/product.md`
4. `docs/architecture.md`
5. `docs/release.md`
6. The current clean-rebuild spec under `.cs/epics/` when present

Treat `docs/upstream-sync.md` as the process source of truth.

## Hard gates

- Default to a stable Paseo release tag. Require explicit approval for beta tags or arbitrary commits.
- Freeze and report the target tag, full commit SHA, and tree SHA before implementation.
- Inspect upstream tags without importing them into BySpace's tag namespace.
- Keep current `main`, npm, Cloudflare, `~/.byspace`, and port `6777` untouched during candidate work.
- Prove the exact unmodified upstream target builds before applying BySpace changes.
- Build a new orphan-root candidate in isolation; do not merge, rebase, or cherry-pick upstream history.
- Reimplement the bounded overlay against the new tree. Do not mechanically replay old rename/deletion commits.
- Keep one writer. Use independent reviewers read-only.
- Never force-push, publish, deploy, or restart production without explicit approval.

## Workflow

1. Discover the newest candidate release with `git ls-remote` or a disposable upstream clone.
2. Compare it with the source baseline recorded in `docs/upstream-sync.md` and `docs/release.md`.
3. Present retained-subsystem impact, excluded-client dependencies, persistence/protocol/toolchain risks, and the rebuild plan.
4. Wait for target approval.
5. Build the unmodified target in a disposable checkout.
6. Create a clean orphan candidate whose root tree exactly equals the frozen upstream tree.
7. Apply separate responsibilities: client-surface reduction, identity migration, distribution, release infrastructure, docs/skills, then necessary review hardening.
8. Run focused tests after each responsibility and the complete candidate gates from `docs/upstream-sync.md`.
9. Audit zero residuals for Electron, native clients, website, Browser automation, old identity, and local Node pins.
10. Forward-test package installation, native modules, daemon lifecycle, and Stable/Beta endpoint selection in isolated homes and ports.
11. Obtain independent reviews for product boundary, persistence/protocol trust, package graph, and release trust.
12. Present source proof, candidate SHA, tests, reviews, backup/cutover sequence, and residual risks.
13. After explicit approval, create and verify an offline bundle, force-push with `--force-with-lease`, and wait for exact-SHA CI.
14. Stop after source convergence. Invoke `release-beta` or `release-stable` only when the user separately asks to ship.

## Failure discipline

- Treat a timeout as evidence, not restart permission.
- Rebuild workspace declarations before patching inferred types.
- Never delete `package-lock.json` or `node_modules` during rename work.
- Delete unsupported capabilities vertically; do not preserve dead branches with false/null stubs.
- Report scope expansion before fixing architecture or data-safety issues not required for the source import.

## Required result

Report the frozen source identity, baseline, overlay commits, validation, review findings, backup path, old/new main SHAs, deferred risks, and whether any production action occurred.
