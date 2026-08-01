# mock provider 是确定性测试 session-import 流程的首选

## 结论

写非 `.real.spec.ts` 的 Playwright e2e 测试，需要一个"确实能被导入"的 provider session 时，用 `providerId: "mock"`（`MOCK_LOAD_TEST_PROVIDER_ID`）——它的 `listImportableSessions()` 恒返回 `[]`（不会出现在自动扫描列表里），但 `resumeSession`/`importSession` 对任意 `providerHandleId` 都无条件成功，不需要真实 CLI、鉴权或预先落盘的会话文件。

## 触发场景

- 需要在 e2e 里验证"导入某个 provider session"的成功/失败路径，但不想依赖 Claude/Codex/OpenCode/Pi 的真实二进制和凭据（那类测试要用 `*.real.spec.ts`，默认 CI 不跑）。
- 需要一个"必然失败"的确定性场景（例如"已导入过的 session 再导一次"）：用同一个 `providerId: "mock"` + 同一个任意字符串 `providerHandleId` 导入两次，第二次会稳定命中 `import-sessions.ts` 的 "Provider session is already imported" 分支。

## 细节

- `mock` 定义在 `DEV_AGENT_PROVIDER_DEFINITIONS`（`packages/protocol/src/provider-manifest.ts`），只有 `isDev`（`BYSPACE_NODE_ENV=development`）时才会被合并进 provider registry；Playwright 的 `packages/app/e2e/global-setup.ts` 启动 daemon 时已经设了 `BYSPACE_NODE_ENV: "development"`，所以 e2e daemon 里 `mock` 总是可用、且默认 `enabled: true`。
- `MockLoadTestAgentClient.resumeSession()`（`packages/server/src/server/agent/providers/mock-load-test-agent.ts`）不校验 `handle.sessionId` 是否真实存在，直接用它构造一个新的 `MockLoadTestAgentSession`——这就是"任意 ID 都能导入成功"的原因。
- Import Session sheet 里手动选 provider 的下拉是 `Combobox`/`ComboboxItem`，选项本身默认没有 `testID`（除非渲染时显式传），e2e 要点选某个 provider 选项时得先确认组件有没有加 `testID={...option.id}`，不能照抄 vitest 里 mock 过的 `Combobox` 的 testid 命名习惯（那是测试替身自己编的，跟真实组件无关）。

## 相关位置

- `.cs/issues/012-x-import-session-manual-id.md`
- `packages/app/e2e/import-session-manual.spec.ts`
- `packages/server/src/server/agent/providers/mock-load-test-agent.ts`
- `packages/app/e2e/helpers/mock-agent.ts`（同一个 `mock` provider 的另一种既有用法：直接建 agent，不经导入）
