# CLAUDE.md

BySpace is a local-first personal compute control plane for monitoring and controlling AI coding agents and user-owned device capabilities. The public Web app connects directly or through the encrypted relay; the shared Expo app has maintained Android/iOS hosts and a maintained Electron Desktop host. Code and execution stay on the daemon machine.

**Supported agents:** direct Claude Code, Codex, OpenCode, and Pi integrations plus ACP-compatible agents.

## Repository map

This is an npm workspace monorepo:

- `packages/server` — Daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Shared Expo client for Browser Web/PWA, Android, and iOS
- `packages/desktop` — Maintained Electron Desktop host
- `packages/expo-two-way-audio` — Native Expo audio module used by maintained mobile hosts
- `packages/cli` — Docker-style CLI (`byspace run/ls/logs/wait`)
- `packages/relay` — E2E encrypted relay for remote access

## Docs

`docs/` is the source of truth for system-level and process-level knowledge. **"The docs", "check the docs", or "check the X docs" always mean this directory — not the web.** Look here before fetching anything online; the docs capture gotchas and conventions you cannot derive from the code or external sources.

At the start of non-trivial work, list `docs/` and skim anything relevant to the task. When you learn something meta worth preserving — a gotcha, a convention, a workflow, a piece of system context that will outlive the current task — update an existing doc or propose a new one. Code-level facts belong in inline comments next to the code; system, process, and gotcha-level facts belong in `docs/`.

| Doc                                                            | What's in it                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [docs/product.md](docs/product.md)                             | What BySpace is, who it's for, where it's going                                                                                |
| [docs/architecture.md](docs/architecture.md)                   | System design, package layering, WebSocket protocol, agent lifecycle, data flow                                                |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)             | Agent states, parent/child relationships, archive semantics, tabs vs archive, subagents track                                  |
| [docs/data-model.md](docs/data-model.md)                       | File-based JSON persistence, Zod schemas, atomic writes, no migrations                                                         |
| [docs/glossary.md](docs/glossary.md)                           | Authoritative terminology — UI label wins, no synonyms                                                                         |
| [docs/coding-standards.md](docs/coding-standards.md)           | Type hygiene, error handling, state design, React patterns, file organization                                                  |
| [docs/design.md](docs/design.md)                               | Theme tokens — colors, fonts, spacing, radii, icons                                                                            |
| [docs/forms.md](docs/forms.md)                                 | Form architecture — non-React form model, form kit, load-state gating; the schedule form is the golden example                 |
| [docs/hover.md](docs/hover.md)                                 | Hover — the canonical pattern (plain View + onPointerEnter/Leave, separate inner Pressable) and the three ways agents break it |
| [docs/unistyles.md](docs/unistyles.md)                         | Unistyles gotchas — `useUnistyles()` is forbidden, alternatives in order                                                       |
| [docs/floating-panels.md](docs/floating-panels.md)             | Anchored popovers — Portal/Modal escape, lifecycle gates, keyboard shared values, and flash prevention                         |
| [docs/expo-router.md](docs/expo-router.md)                     | Expo Router route ownership and startup restore                                                                                |
| [docs/file-icons.md](docs/file-icons.md)                       | Material icon theme integration for the file explorer                                                                          |
| [docs/providers.md](docs/providers.md)                         | Adding a new agent provider end-to-end                                                                                         |
| [docs/custom-providers.md](docs/custom-providers.md)           | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries                                              |
| [docs/service-proxy.md](docs/service-proxy.md)                 | Service proxy: exposing workspace scripts at public URLs, DNS setup, reverse proxy config                                      |
| [docs/remote-web-services.md](docs/remote-web-services.md)     | Private daemon-to-daemon HTTP/SSE/WebSocket services, Data Relay topology, deployment, and VPS migration                       |
| [docs/development.md](docs/development.md)                     | Dev server, build sync gotchas, CLI reference, agent state, Playwright MCP                                                     |
| [docs/android.md](docs/android.md)                             | Android toolchain, generated native project, sideload builds, emulator, and direct/Relay smoke testing                         |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)             | WebSocket RPC naming convention — dotted namespaces and `.request`/`.response` pairs                                           |
| [docs/protocol-validation.md](docs/protocol-validation.md)     | zod-aot generated inbound WebSocket validation, patched compiler regressions, schema-purity rules                              |
| [docs/terminal-performance.md](docs/terminal-performance.md)   | Terminal latency pipeline, coalescing/backpressure invariants, benchmark + perf spec usage                                     |
| [docs/testing.md](docs/testing.md)                             | TDD workflow, determinism, real dependencies over mocks, test organization                                                     |
| [docs/mobile-panels.md](docs/mobile-panels.md)                 | Compact browser viewport panel ownership, motion, and gesture revisions                                                        |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md) | Isolated in-process daemon test harness                                                                                        |
| [docs/docker.md](docs/docker.md)                               | Running the daemon and bundled web UI in Docker, volumes, agent images, security                                               |
| [docs/release.md](docs/release.md)                             | Release playbook, draft releases, completion checklist                                                                         |
| [docs/client-distribution.md](docs/client-distribution.md)     | Public Desktop/Android release artifacts, signing, checksums, and explicit iOS no-publish boundary                             |
| [docs/upstream-sync.md](docs/upstream-sync.md)                 | Release-level delta workflow for synchronizing upstream changes onto current BySpace `main`                                    |
| [docs/release-engineering.md](docs/release-engineering.md)     | Packaging, CI/CD, channel isolation, cutover, and incident-derived release controls                                            |
| [docs/terminal-activity.md](docs/terminal-activity.md)         | Terminal activity indicators — source-agnostic tracker, agent hook reporting, adding a new hook provider                       |
| [SECURITY.md](SECURITY.md)                                     | Relay threat model, E2E encryption, DNS rebinding, agent auth                                                                  |

## Quick start

```bash
npm run dev                          # Start the dev daemon
npm run dev:app                      # Start Expo against the dev daemon
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Always run after changes
npm run lint                         # Always run after changes
npm run format                       # Auto-format with Biome
npm run format:check                 # Check formatting without writing
```

Repo dev commands use checkout-local state by default. In this checkout, `BYSPACE_HOME` resolves to `.dev/byspace-home`, and `npm run cli -- ...` targets that same dev home automatically. Production-style daemons use `~/.byspace` on port `6777`.

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main BySpace daemon on port 6777 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **For any Paseo/upstream check or update, use `.agents/skills/upstream-sync/SKILL.md`.** Freeze the old and new upstream releases, agree on what to take, then copy the approved aggregate release delta onto current BySpace `main`; never merge, rebase, cherry-pick, replace history, or revive per-commit sync ledgers. Sync is source transfer, not upstream review or product development: only deterministic mechanical BySpace adaptations are autonomous. If upstream appears wrong or adaptation requires a product/architecture choice, stop before coding and ask the user.
- **For any release, use the matching `release-beta` or `release-stable` skill.** Main runs CI only; never create a release tag before exact-SHA push CI succeeds.
- **Before changing app routes, startup routing, remembered workspace restore, or active workspace selection, read [docs/expo-router.md](docs/expo-router.md).**
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - Run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Always run typecheck and lint after every change.**
- **Build workspace packages before diagnosing cross-package type errors.** This repo consumes generated declarations across workspaces. If typecheck fails in a package that depends on another workspace, rebuild the owning stack first so `dist` declarations are current:
  - `npm run build:client` — rebuild protocol and client declarations.
  - `npm run build:server` — rebuild highlight, relay, protocol, client, server, and CLI when server/CLI types may be stale.
  - Do not patch inferred callback parameters or add local duplicate types just to silence stale declaration errors.
- **Run `npm run format` before committing.** This repo uses Biome for formatting. Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **The protocol stays backward-compatible. Features don't have to.** Two separate contracts:
  - **Protocol contract (always):** schema changes must not break parsing in either direction. An old client must still parse messages from a new daemon; a new daemon must still parse messages from an old client.
    - New fields: `.optional()` with a sensible default.
    - Never flip optional → required, remove fields, or narrow types (`string` → `enum`, `nullable` → non-null).
    - Removed fields stay accepted (we stop sending them, not stop reading them).
    - Test with: "does a 6-month-old client still parse this?" and "does a 6-month-old daemon still send something this client accepts?"
    - Wire schemas are pure structural declarations. Do not add `.transform()`, `.catch()`, or `.preprocess()` to WebSocket message schemas; put normalization in an explicit post-validation pass.
    - Plain `z.union()` is forbidden when every branch has a shared literal tag. Use `z.discriminatedUnion()` unless generated-code regression tests prove that specific shape is miscompiled.
    - `.default()` is acceptable on primitive leaves only. Never put defaults on item schemas for large arrays or big inbound containers.
  - **Feature contract (per-feature):** a new feature may require a new daemon capability. The client detects whether the capability is present and either runs the feature or shows "Update the host to use this." That's it.
    - **No fallback paths.** Don't write a degraded version of a new feature that runs on old daemons. Don't fan out across legacy RPCs to simulate a missing capability. The user upgrades or doesn't get the feature.
    - **No defensive branches scattered through the feature.** Capability detection happens in one place; downstream code reads a clean shape.
    - **Capability flags live in `server_info.features.*`** with a single `// COMPAT(featureName): added in v0.1.X, drop the gate when floor >= v0.1.X` comment marking the cleanup site.
    - Existing functionality keeps working across versions — that's the protocol contract doing its job. New-feature degradation is not the goal.
    - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.

- **All back-compat shims are tagged and dated for cleanup.** Every shim that exists for old-client/old-daemon support carries a `COMPAT(name)` comment with the version it was added in and a target removal date (typically 6 months out). One grep — `rg "COMPAT\("` — should produce the full list of cleanup work. Don't bury back-compat in untagged `??`-fallbacks or optional-chain tunnels — that's how it stops being deletable.

## Multi-client boundary

BySpace maintains one shared product across Browser Web/PWA, Android, iOS, Electron Desktop, and the CLI. Stable/Beta releases publish Web/PWA, npm CLI/daemon, Relay, signed Android APK, and checksummed Electron artifacts for macOS/Linux/Windows from one immutable tag. iOS is maintained source/prebuild/test surface only and is never built, submitted, or uploaded by active CD.

- Keep shared product journeys in platform-neutral Expo/React code; put actual OS access in `.web`, `.native`, Expo module/config-plugin, or Electron main/preload adapters.
- Use browser APIs directly in Web-owned modules and keep SSR-safe guards when modules can load before `window` exists.
- Distinguish compact browser layouts from native mobile behavior; “mobile” viewport terminology alone does not imply Android/iOS.
- Do not delete, stub, or skip Android/iOS/Electron/Browser-automation code. Every maintained platform slice participates in upstream audits even though iOS is not distributed.
- iOS must not evaluate daemon-delivered dynamic plugin client bundles; first-party compiled client behavior remains allowed.
- Active release CD must publish Desktop and Android assets and must not contain an iOS build/submit/upload path. Follow [docs/client-distribution.md](docs/client-distribution.md).
- Validate every client change with App typecheck and a real Web export. Also run the documented build/prebuild/smoke for each native or Electron surface the change touches.

## Debugging

Find the complete daemon logs and traces in the $BYSPACE_HOME/daemon.log
