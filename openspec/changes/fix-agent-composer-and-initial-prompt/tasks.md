# Tasks

## 1. Composer track presentation

- [x] 1.1 Remove the unconditional edge mask in `web/src/composer/tracks.tsx`, preserve horizontal scrolling, and add a non-overflow rendering regression to `web/src/composer/tracks.test.ts`; verify with `cd web && npx vitest run src/composer/tracks.test.ts --bail=1`.

## 2. Reload operation feedback

- [x] 2.1 Add the workspace reload toast helper using one `agent-reload:<agentId>` id for pending and terminal states, and cover success and failure replacement in `web/src/screens/workspace/agent-reload-toast.test.ts`; verify with `cd web && npx vitest run src/screens/workspace/agent-reload-toast.test.ts --bail=1`.
- [x] 2.2 Use the helper for loading, success, and failure in `handleReloadAgent` in `web/src/screens/workspace/workspace-screen.tsx`; verify the focused toast test still passes and the callback leaves no separate indefinite toast on either outcome.

## 3. Pi startup image prompts

- [x] 3.1 Change the image preflight in `internal/agent/pi/pi.go` to reject only a negotiated text-only model while forwarding when `modelInput` is nil, without adding a startup RPC or changing advertised capabilities.
- [x] 3.2 Adapt `TestPromptForwardsImageBlocksToPi` in `internal/agent/pi/pi_test.go` to prompt before `GetState` and retain negotiated text-only rejection coverage; verify with `go test ./internal/agent/pi -run 'TestPrompt'`.

## 4. Initial-prompt creation failures

- [x] 4.1 Propagate synchronous `Prompt` errors in `handleCreateAgent` in `internal/server/server.go` through the existing discard and `agent_create_failed` path before appending a submitted row or sending `agent_created`.
- [x] 4.2 Add `TestCreateAgentFailsWhenInitialPromptIsRejected` using the mock provider's `mockPromptRejections` feature and assert the failure response plus in-memory and persisted cleanup; verify with `go test ./internal/server -run '^TestCreateAgentFailsWhenInitialPromptIsRejected$'`.

## 5. ACP negotiated image capabilities

- [x] 5.1 Update `internal/agent/providers/acp.go` to report image support from `agentCapabilities.promptCapabilities.image`, default omitted or malformed metadata to unsupported, and reject unsupported image prompts before changing turn state or appending timeline entries.
- [x] 5.2 Add `TestACPNegotiatedImageCapability` and `TestACPPromptRejectsImagesBeforeStartingTurnWhenUnsupported` in `internal/agent/providers/acp_capabilities_test.go`; verify with `go test ./internal/agent/providers -run 'TestACP(NegotiatedImageCapability|PromptRejectsImagesBeforeStartingTurnWhenUnsupported|ClientCapabilities)$' -count=1`.

## 6. Integration verification

- [x] 6.1 Run `npm run format`, `npm run typecheck`, and `npm run lint`; verify all complete without errors and inspect the resulting diff for unintended changes.
- [x] 6.2 Run `npm run audit` for the Go and web conformance checks, using `--no-browser` only when no daemon is available; verify every applicable check passes.
