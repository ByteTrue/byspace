---
kind: issue
title: "Go 单二进制真机浏览器对齐修复批次（流式、状态、思考档位、Chief 置顶、多模态附件）"
type: bug
created: 2026-10-20
---

# Go 单二进制真机浏览器对齐修复批次

## 目标与范围

把 `refactor/go` 分支的 Go 版守护进程放到真实浏览器（`bsk` 驱动 Chrome 连 `127.0.0.1:6778`）与真实 `pi`（`bytetrueapi/deepseek-flash`）下逐个页面使用，修掉与 Node 版行为不一致的地方。

- **包含**：出站消息缺字段、流式时序、轮次存活状态、模型思考档位过滤、Home workspace 语义、多模态图片透传。
- **不包含**：其它 Agent 宿主（Claude/Codex/ACP/OpenCode）真实二进制验证、双机 tunnel。

归属：`byissue/epics/2026-10-19-o-go-single-binary-full-parity`。

## 背景

Epic 的实现阶段只做到「协议 Schema 校验通过 + 单元测试绿」。Schema 里大量功能字段是 `.optional()`，缺字段不报错但前端特性静默退化，所以必须真机使用才能暴露。用户明确要求：**所有工作走 bi 流程记录**，包括小修复。

## 现状怎么工作（修复前）

| 现象                                               | 根因                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Providers 页多出 Cursor/Kimi/Kiro/Trae             | `BuiltinProviders` 把 ACP 预设当成常驻内置项                                              |
| 侧边栏 `Chief` 不置顶、每行挂 `+0 -0`              | `buildWorkspaceDescriptor` 漏 `labels`；`diffStat` 硬编码 `{0,0}`                         |
| `fetch_workspaces_response` 被前端拒绝、回退旧缓存 | `project.checkout.mainRepoRoot` 缺失                                                      |
| 用户消息渲染两次                                   | 未回填 `clientMessageId`/`messageId`；`direction:"after"` 重发全部历史                    |
| 上一轮回复串到下一轮                               | `message_end` 未判 `role==="assistant"`，user 的 `message_end` 触发 `LastAssistantText()` |
| 无思考/工具卡片、非流式                            | `message_update` 只累加内存，未推 `agent_stream`                                          |
| 一卡一卡、隔段蹦出                                 | 同一条消息所有 delta 共用一个 `seq`，前端按 `endSeq+1` 去重丢弃                           |
| 轮次结束后仍显示运行中                             | 前端认顶层 `agent_update`，Go 发的是 `status:"agent_updated"`                             |
| 多步工具任务中途就变 idle                          | 内部结束事件命名 `turn_end`，与 pi 原生 `turn_end`（每步都发）撞名                        |
| 思考档位固定 6 档、缺 `Max`                        | 未解析模型 `thinkingLevelMap`                                                             |
| `Chief` 顶栏出现 GitHub 按钮、worktree 提示        | Home workspace 的 cwd 父目录含 `.git`，被判定为 git 仓库                                  |
| 图片没到模型手里                                   | `send_agent_message_request` 的 `images`/`attachments` 未解析                             |

## 执行记录

提交顺序（`refactor/go`）：

1. `571d...` providers 收敛为 6 个内置 + `ACPPresets` 按需挂载（`source: "custom"`）。
2. `1ba4bd7e4` `buildWorkspaceDescriptor` 补 `labels`；`server_info.features.agentRoleNames=["chief"]`；`store.EnsureHomeWorkspace` 启动自举 `$BYSPACE_HOME/chief`。
3. `13d04341a` 补 `server_info.features` 15 个开关、`AgentCapabilities.supportsRewind*`、`availableModes`/`features`、`fetch_agent_response.project`、`MutableDaemonConfig` 默认字段、`create_agent` 的 `role`/`systemPrompt`/`labels`。
4. `861470406` 实时推 `thinking_delta`/`text_delta`/工具开始结束；`message_end` 判 role；`clientMessageId` 回填；`agent_update` 广播；进程级 `epoch`；`project.checkout.mainRepoRoot: null`。
5. `1b33cd659` 模型 `thinkingLevelMap` 过滤（含 `max`/`xhigh`）与默认档位；`activeTurn` 如实下发；`Chief` 判 `non_git`（`GetCheckoutStatus` + 描述符双保险）。
6. `2958453b4` 引入单调 `streamSeq`；内部事件改名 `byspace_*` 避开 pi 原生 `turn_end`；`stripLeadingSectionTag` 状态机替换正则处理拆包前缀。
7. 本文件同批：`send_agent_message_request` / `create_agent_request` 解析 `images` 与 `attachments`。图片编成 pi 的 `{type:"image",data,mimeType}` 块随 `prompt` 下发；非图片附件追加 `[Attached file: … at …]` 文本行让模型按路径读取。
   - 关键点：协议字段名是 `text`（不是 `prompt`）+ `images`/`attachments`，之前两个都没解析，所以图片被静默丢弃。
   - 单测 `TestPromptForwardsImageBlocksToPi` 断言 base64 与 mimeType 完整出现在发往 pi 的 `prompt` 帧里。
8. 图片透传补齐到全部宿主（不只是 pi）。每个宿主的线上形状不同，不能共用一个 map：
   - Claude：`{type:"image", source:{type:"base64", media_type, data}}`
   - Codex：`{type:"image", url:"data:<mime>;base64,<data>"}`
   - ACP：`{type:"image", data, mimeType}`
   - OpenCode：`{type:"file", mime, url:"data:…"}`（它的 API 把附件建模成 file part）
   - 守卫：`TestEveryProviderForwardsImageBlocks` + `TestImageBlocksSkipEmptyData`。
9. 引入 `scripts/go-parity-audit.mjs` 与 CI 守卫（见上节），把「字段漏解析」类问题变成可执行断言。
10. 按审计报告补齐的入站字段（全部接线，不是只加 struct）：

- `send_agent_message_request.activeTurnBehavior` → `steer` 走 `Steer`，否则新开轮次
- `create_agent_request`：`idempotencyKey`/`env`/`callerAgentId`/`worktreeName`/`outputSchema`/`git`/`autoArchive`；`env` 已透传到 provider 进程环境
- `create_byspace_worktree_request`：`checkoutSource`/`githubPrNumber`/`nameContext`/`firstAgentContext`
- `fetch_agents_request`：`scope`(active/archived/all) + `page{limit,cursor}`；`fetch_workspaces_request.page`、`fetch_agent_history_request.page`
- `fetch_recent_provider_sessions_request.since`（按 mtime 过滤）
- `directory_suggestions_request`：`includeFiles`/`includeDirectories`/`matchMode`(prefix|contains)
- `capture_terminal_request`：`start`/`end`/`stripAnsi`（新增 `terminal.StripAnsi` + 单测）
- `set_agent_feature_request`：`featureId`/`value` 落盘到 `config.featureValues` 并广播 `agent_update`
- `checkout_commit_request.addAll`、`checkout.discard_changes.request.paths`、`checkout_pr_merge_request.mergeMethod`、`checkout_merge_request.strategy|requireCleanTarget`、`stash_pop_request.stashIndex`、`stash_list_request.byspaceOnly`
- `byspace_worktree_archive_request.scope|deleteWorktreeFromDisk`（新增 `workspace.RemoveWorktreeFromDisk`）
- `agent.fork_context.request.boundaryCursor`（按 seq 截断 timeline）、`resume_agent_request.handle|overrides`
- `pull_request_timeline_request.repoOwner|repoName|prNumber`、`forge.search.request.kinds`、`project.github.clone.request.cloneProtocol`
- `file_explorer_request.acceptBinary|maxBytes`、`file.upload.request.modifiedAt`
- `subscribe_terminal_request.restore`、`session.events.set_subscription.request.events`、`hello.clientType|capabilities`
- `get_providers_snapshot_request.ifNoneMatch`（命中回 `notModified`）
- `hub.*` / `plugin.source.install.request` 的可选字段

11. 新增真功能的未路由消息：

- `workspace.setup.run.request` / `workspace_setup_status_request` → `internal/server/ws_plugin_setup.go` 执行 `byspace.json` 的 `setup` 命令（逐条 `/bin/sh -lc`，采集日志与退出码，广播 `workspace_setup_update`，快照可轮询）
- `plugin.*` 共 13 条 → 只读端（list/catalog/logs/source.status/source.update）如实返回空目录；写端（install/enable/disable/reload/remove/rpc.invoke）明确回报 "plugin runtime is not available on this daemon build"，不假装成功

## 验证

- `go test ./...` 全绿；`npm run typecheck` 全绿。
- WebSocket 抓包：`agent_stream` 逐 token `seq` 严格 `+1`，`turn_completed` 只在 `agent_end` 出现一次。
- 浏览器：多轮流式、思考折叠、Shell 卡片、进行中计时与停止按钮、思考档位菜单（DeepSeek V4.1 Flash → Off/Low/High/Max）、`Chief` 置顶无 `+0 -0`。
- 图片：`TestPromptForwardsImageBlocksToPi` 抓 pi 入站帧，确认 `images:[{type:image,data,mimeType}]` 原样送达；`bytetrueapi/deepseek-flash` 的 `input` 含 `image`。
- 未验证：浏览器内真实拖图上传走 `attachments`/`uploaded_file` 的链路只有单测覆盖，没有做出可视化确认（缺一张真图在 UI 里的端到端截图）。

## 关闭回写

关闭时把「Schema 校验通过 ≠ 前端正确」这条教训写进 Epic 的验证要求。
