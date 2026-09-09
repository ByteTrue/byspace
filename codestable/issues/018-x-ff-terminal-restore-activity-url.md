---
kind: issue
title: "修复 daemon 重启后恢复的终端缺失 activity URL，导致 agent 状态不上报"
type: ff
status: closed
created: 2026-09-09
---

# 修复 daemon 重启后恢复的终端缺失 activity URL，导致 agent 状态不上报

修复 daemon 启动时终端 restore 在 HTTP server listen 之前执行的问题。restore 走 `createTerminal` 时 `boundListenTarget` 还是 null，`getTerminalActivityUrl()` 返回 null，恢复的终端环境里没有 `BYSPACE_TERMINAL_ACTIVITY_URL` / `PASEO_TERMINAL_ACTIVITY_URL`，pi/claude/codex 的 agent hook 扩展因缺 URL 三要素校验不过而静默 no-op——此后该终端里所有 agent 会话（包括 resume）永远不上报运行状态。表现为"偶尔不显示状态"，实际由 daemon 重启触发，与 resume 本身无关（异常中断常伴随重启，才形成 resume 后必现的错觉）。

- 改动：`packages/server/src/server/bootstrap.ts` — `restorePersistedTerminals` 从主 bootstrap 流程（registry 初始化后）移入 listening 回调内、`wsServer.beginAcceptingConnections()` 之前执行，保证 restore 时 `boundListenTarget` 已赋值且客户端连接前 restore 完成
- 验证：server 包 typecheck 通过；`terminal-persistence` / `agent-hooks/pi` / `terminal-activity-route` / `bootstrap` 四个测试文件全绿；bootstrap.ts lint 0 警告。实测证据：daemon.log 两次启动均为 restore（…70304/…87446）先于 Server listening（…70318/…87466）；本会话终端 `terminals.json` 中的 `6020169f` 实测缺 URL、手动 POST activity 端点返回 204
- codestable：无现有真相失效；`docs/terminal-activity.md` 的 env 注入描述仍成立
