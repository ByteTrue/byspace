---
kind: issue
title: "导入失败时把 Go 的原始错误直接甩给用户，且 recent 导入不显示原因"
type: bug
created: 2026-10-28
---

# 导入失败时的错误信息

## 预期与实际

**预期**：在 import-session 面板里点一行，该会话被导入，面板关闭，跳到已水合的 transcript。

**实际**：`import-session-sheet` 一直存在（`toHaveCount(0)` 等 30 秒失败），transcript 没出现。
`import-session-flow.spec.ts` 的 `captures the compact import-session journey` 因此失败；同一文件另一条
用例通过。

## 根因：本机没有 `claude` CLI

把 `importMutation.error.message` 渲染出来之后，答案就在屏幕上：

```
Could not import selected session. [exec: "claude": executable file not found in $PATH]
```

导入一个 Claude 会话要启动 `claude`（`startOrGetPiAgent` 会拉起 provider CLI），本机 PATH 上只有
`opencode`，没有 `claude`/`codex`。**这不是产品缺陷**：CI 的 `Install agent CLIs` 步骤装了
`@anthropic-ai/claude-code`、`@openai/codex`、`opencode-ai` 三个，所以这个 spec 在 CI 上是绿的，
本机是红的。同一类还有 `new-workspace-mode-cycle-safety` 与 `new-workspace-codex-mode-preferences`
（都缺 `codex`）。

## 顺带修掉的一个真实缺陷：错误信息是给人看的吗

上面那条消息里，`exec: "claude": executable file not found in $PATH` 是 Go 的原始错误，被 import sheet
原样渲染给用户。它读起来像 BySpace 坏了，而实际上是这台机器缺工具。

新增 `importFailureMessage(provider, err)`：识别 `exec.ErrNotFound` 与 "executable file not found"，
换成 `importing a claude session needs the claude command on this host's PATH`。接线在
`handleImportAgent` 的两个失败出口（转录读取、agent 启动）。

同时给 import sheet 接上了错误正文（`importErrorMessage`）：此前 recent 导入失败只显示
"Could not import selected session."，**服务端给的原因被丢掉了** —— 这条 issue 之所以难查，
就是因为那个 message 从来没到过屏幕上。

## 原来的调查记录（保留）

## 已确认的事实

失败发生在 `ImportSessionFlow.importSession(id)`：点击行之后面板不关。

失败的截图（`test-results/…/test-failed-1.png`）里，面板顶部显示
`Could not import selected session.` —— 那是 `importSession.status.failedImport`，由
`SheetStatusMessages` 在 `importMutation.isError && variables.source !== "manual"` 时渲染。
**所以导入请求确实发出去了，并且失败了**，不是点击没生效。

同一次运行里还有 `Could not load Mock Load Test sessions` 与 `Could not load Broken ACP sessions`
两条 provider 错误行 —— 后者是 fixture 故意造的（测试里 Retry 那一步就是要它出现），前者需要解释。

对照：用 pi 会话对临时 daemon 直接发 `import_agent_request`（`providerId` + `providerHandleId`）是**成功**的，
`agent_resumed` 的字段（`status`/`agentId`/`requestId`/`timelineSize`/`agent`）也齐全。所以不是这条 RPC 的整体问题，
是 fixture 里那个 claude 会话走到某个失败分支。

## 影响面

## 影响面

**必须改**：待定，取决于上面那个问题。

**需要验**：`import_session` 请求与响应、面板的关闭条件、导入后路由跳转。

## 验证

1. `import-session-flow.spec.ts` 两条全绿
2. 手工通过 UI 导入一个 Claude/Codex/pi 会话，确认面板关闭且 transcript 完整

## 沉淀去向

- **`docs/testing.md` →「Before debugging a failure, check the test reached its subject」**：
  本机缺 `claude` / `codex` 导致两条 spec 红，CI 装了就没问题——环境差异伪装成产品缺陷。
  判据是先用 `node scripts/e2e-runnable.mjs` 确认 spec 是否在当前机器可跑。
- 错误文案的整改落在代码里（`importFailureMessage`），属于代码级事实，不进 docs。
