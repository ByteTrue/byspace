---
kind: issue
title: "Git Changes 刷新被 Forge 查询阻塞"
type: bug
status: closed
created: 2026-08-11
---

# Git Changes 刷新被 Forge 查询阻塞

## 做成以后是什么样

Changes 面板的刷新先返回本地 Git 状态并启动 diff；同一次刷新继续在后台强制获取 Forge 状态，完成后通过既有 `checkout_status_update.prStatus` 推送，使新出现的 PR 面板自动可见。

## 当前坏在哪

2026-08-11 本项目一次 `checkout.refresh.request` 用时 21.856 秒。同窗口 Git 子进程 p95 为 26ms、最大 32ms，event loop p99 约 11ms；响应后的 diff 请求用时 1.051 秒。主耗时来自刷新强制串行等待 `gh auth status`、`gh pr view`、`gh repo view`、`gh pr list`。本机复测四次调用合计 4.786 秒，网络抖动时会放大到数十秒。

## 方案与验证

保持 RPC 与客户端调用不变：服务端先强制生成不含 Forge 的本地快照、调度 diff 并响应，再异步强制生成含 Forge 的完整快照。验证响应不等待被阻塞的 Forge 查询、后台刷新仍启动、tilde 路径仍正确，并运行改动文件测试、格式化、typecheck 与 lint。

## 执行记录

- `CheckoutSession.handleRefreshRequest` 先等待 `includeForge: false` 的强制快照，调度 diff 并返回成功，再后台触发 `includeForge: true` 的强制快照。
- 后台完整快照沿用已有 workspace snapshot 更新链路；其中的 `prStatus` 会更新客户端 PR 查询缓存，因此新 PR 仍会让面板自动出现。
- 测试用未释放的 Forge Promise 证明 refresh 响应不再等待 Forge，同时断言后台完整刷新已启动。
- 验证通过：目标测试 35/35、格式检查、根 typecheck、根 lint 与 Git whitespace 检查。

## 关闭结论

- 可关闭：本地 Git 响应已与 Forge 网络等待解耦，同一次刷新仍在后台完成 Forge 读取并发布 Pull Request 状态。
- 验证：阻塞 Forge 的回归测试证明本地响应先完成且后台刷新已启动；目标测试 35/35，根 typecheck、lint、格式与 whitespace 检查通过。
- 毕业回写：稳定行为已写入 `codestable/spec/index.md` 的「Git 与 Forge」及 `docs/architecture.md` 的 Workspace Git/forge 架构说明。
- 遗留：当前正在运行的主 daemon 未重启；变更随后续正常构建与重启生效，无代码层遗留事项。
