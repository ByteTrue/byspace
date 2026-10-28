---
kind: issue
title: "导入会话后面板不关闭：选中一行没有任何反应"
type: bug
created: 2026-10-28
---

# 导入会话后面板不关闭

## 预期与实际

**预期**：在 import-session 面板里点一行，该会话被导入，面板关闭，跳到已水合的 transcript。

**实际**：`import-session-sheet` 一直存在（`toHaveCount(0)` 等 30 秒失败），transcript 没出现。
`import-session-flow.spec.ts` 的 `captures the compact import-session journey` 因此失败；同一文件另一条
用例通过。

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

## 仍未定位

`importMutation` 的 `error.message` 是空的（UI 落到了 `fallbackFailure`），所以看不到服务端给的原因。
下一步要把这个 message 露出来：或让 `onError` 对 recent 也写进可见状态，或直接开 WS 抓那条 `status` 错误。

## 影响面

## 影响面

**必须改**：待定，取决于上面那个问题。

**需要验**：`import_session` 请求与响应、面板的关闭条件、导入后路由跳转。

## 验证

1. `import-session-flow.spec.ts` 两条全绿
2. 手工通过 UI 导入一个 Claude/Codex/pi 会话，确认面板关闭且 transcript 完整
