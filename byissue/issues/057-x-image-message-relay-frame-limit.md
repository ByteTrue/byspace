---
kind: issue
title: "大图片消息超 Relay 帧上限：发送前客户端压缩，超限图片走分块上传"
type: feature
status: closed
created: 2026-09-29
closed: 2026-09-29
---

# 大图片消息超 Relay 帧上限：发送前客户端压缩，超限图片走分块上传

## 现象与根因

用户在远端设备（PWA 走 Relay）发两条提示词 + 两张 4K 原图，composer 报 `Relay frame exceeds size limit`，消息发不出去。

- 图片在协议里是内联 base64：`ImageAttachmentSchema = { data: string /* base64 */, mimeType }`（`packages/protocol/src/messages.ts:1331`），一条 `send_agent_message` 把文字 + 全部图片打成一个 WebSocket 帧。
- 该帧过 Relay 时受单帧 32 MiB 上限约束（`packages/server/src/utils/checkout-git.ts:2100` 的 `RELAY_MAX_FRAME_BYTES` 注释明说 binding）。帧是 E2EE 密文再 base64，wire 膨胀 4/3（`packages/relay/src/encrypted-channel.ts:125-129`），换算明文预算约 24 MiB。
- App 端对图片零压缩零降采样（composer 选图/粘贴链路无 resize 逻辑），4K PNG 截图单张 8~15 MB、base64 后 +33%，两张轻松超 24 MiB。
- 报错字符串不在本仓库源码与 git 全历史中——来自线上部署的 Relay worker（版本比本 worktree 新）。远端设备报错，本机 daemon.log 无此条。

结论：不是"平台传不了图"，是**发送前没有任何压缩**，4K 原图直出撞帧上限。同类 agent 客户端（Claude Code 等）均在发送前压缩。

## 目标与范围

切片 1（本切片，做）：

- 所有经 composer 发送的图片，在**上 wire 前自动压缩**：超过阈值或长边超 2048px 时，降采样到长边 ≤ 2048、重编码 JPEG q0.85（透明底合成白底）。
- 压缩点在 `encodeAttachmentsForSend`（`packages/app/src/attachments/service.ts:80`）——粘贴、选图、拖拽、浏览器元素截图、新建工作区首条消息、重发全部汇聚于此，单点覆盖所有入口。
- store 原图不动：预览仍是原图，只有 wire payload 压缩。压缩失败/环境不支持 canvas 时回退原图，绝不因压缩失败阻断发送。
- GIF（会丢动画）与 SVG（矢量）跳过；重编码后反而更大的（罕见）用回原图。

切片 2（同一 issue，后续批次）：

- 压缩后仍超预算的图片（如超高分辨率照片）走既有分块上传通道（`FileBegin/FileChunk/FileEnd`，文件附件已在用）作为 workspace 文件引用发送，agent 端读本地文件。图片不再内联。
- 需要设计：图片类附件走文件引用后，各 provider 对路径图片的视觉输入能力不同（Claude Code Read 工具可读图，其余 provider 待查）。

不包含：压缩开关设置项（默认全压，先观察）；时间线显示逻辑改动。

## 必须保持的外部行为

- 压缩失败（解码失败、canvas 不可用、存储异常）必须回退原始字节发送，行为与今天完全一致——压缩只优化成功路径。
- 非 image mimeType 与小图（< 1 MiB 且尺寸达标）字节不变。
- 消息文本、附件（文件/PR/review 等）路径不经过压缩。
- 线上未更新 daemon / 旧 app 混跑不受影响：压缩纯客户端，wire 协议未变（仍是 `{ data, mimeType }`）。

## 现状怎么工作

- 发送链：`dispatchComposerAgentMessage`（`composer/actions.ts:204`）→ `encodeImages`（`utils/encode-images.ts`，薄包装）→ `encodeAttachmentsForSend`（`attachments/service.ts:80`）→ `store.encodeBase64`。
- store：web 用 IndexedDB blob（`web/indexeddb-attachment-store.ts`），`AttachmentStore` 接口（`attachments/types.ts`）只有 `encodeBase64`/`resolvePreviewUrl`，没有取原始 blob 的方法——切片 1 给接口加可选 `loadBlob?`。
- 压缩 API：web-only 构建，`createImageBitmap` + `OffscreenCanvas`/canvas 可用；非浏览器环境（单测）须优雅降级。

## 执行痕迹

切片 2 已实现（2026-09-29）：

- 新增 `packages/app/src/composer/attachments/image-wire-budget.ts`：
  - `selectInlineImages`：预算 = 16 MiB（Relay 32 MiB wire ÷ 4×3 ≈ 24 MiB 明文，留 envelope/正文/附件余量）− 非图片余量 2 MiB − 正文字节数 − 附件序列化字节数；按 base64 长度升序保留尽量多张，返回索引保序。
  - `enforceImageWireBudget`：超限图片逐张走 `client.uploadFile`（既有 1 MiB 分块二进制帧通道），成功则追加 `uploaded_file` 附件；**上传失败回退内联**（今天的失败行为是地板，分块是改进，不因上传暂时失败而丢图）。
  - `fileNames` 与 images 长度不一致时忽略（encodeBase64 失败会丢张导致错位）。
- 三处 `encodeImages` 调用点全部接入：`composer/actions.ts` `dispatchComposerAgentMessage`、`composer/draft/create-agent-request.ts` `requestWorkspaceDraftAgent`（新建工作区首条消息）、`contexts/session-context.tsx` `_createAgent`。发送端本地乐观渲染不变（仍用本地 metadata 显示原图）。
- agent 侧拿到的是 `uploaded_file` 附件 → prompt 渲染为路径+元数据（`prompt-attachments.ts` `renderPromptAttachmentAsText`），不内联内容；Claude Code 可用 Read 工具读图，其余 provider 能力差异见下文待查项。上传落盘 `<byspaceHome>/uploads/<id>/<fileName>`，与文件附件同生命周期。

与设计的偏差：无。预算执行包裹在 try/catch 里，任何异常不影响发送（退化为原始行为）。

## 验证

切片 1：

- `npx vitest run packages/app/src/attachments/compress-image.test.ts packages/app/src/attachments/service.test.ts --bail=1` → 12/12 通过。新增用例：阈值/格式判定 4 条；压缩模块降级 2 条；service 接线 4 条（store 无 loadBlob 直通、小图不加载 blob、loadBlob 抛错回退原字节、原字节兼容输出不变）。
- 成功路径（真实 4K 图压缩）无 node 环境可测（无 `createImageBitmap`），留待浏览器手验：composer 贴大图发送，观察 daemon 日志帧大小。
- 测试曾抓到一个真实缺陷：catch 回退分支漏包对象返回裸 string——已修。

切片 2：

- `npx vitest run packages/app/src/composer/attachments/image-wire-budget.test.ts packages/app/src/composer/actions.test.ts --bail=1` → 52/52 通过。新增：预算选择 4 条（全内联、保最多张、正文耗尽预算、保序）、上传包装 4 条（全内联不触发、超限上传+附件追加、上传抛错回退、file:null 响应回退）、dispatch 接线 1 条（17 MiB 图 → images 清空 + uploaded_file 附件）。
- 测试共抓到 3 个我自己的错误：`Array.from(12M bytes)` OOM、base64 'A' 解码为 0 而非 65、fake 里 `null ?? 默认值` 吞掉失败响应——全部修正，实现未变。
- 汇总：`npx vitest run`（四文件）63/63；`npm run typecheck` 0 错误；`npm run lint` 0 警告；`npm run format` 完成。
- 端到端验证留待浏览器：同一连接下发多张压缩后仍超 16 MiB 的图，确认 daemon 收到 uploaded_file 附件且 agent 能读盘。

## 关闭候选

- 压缩参数（1 MiB 阈值 / 2048px / q0.85）进 spec 或 notes。
- 「Relay 帧上限 ≈ 明文 24 MiB」的换算事实若 `docs/timeline-sync.md` 之外没有归属文档，考虑补进连接/传输相关 doc。

## 关闭结论

2026-09-29 交付关闭。两个切片均已实现并验证（63/63 测试、typecheck/lint/format 全绿）：压缩在唯一上 wire 汇聚点 `encodeAttachmentsForSend` 单点覆盖所有入口；预算执行接入全部三处发送路径；所有失败路径回退旧行为，不阻断发送。质量目标兑现：功能正确性（测试覆盖决策与接线）、可靠性（全链路回退）、兼容性（wire 协议未变，旧 daemon/新 app 混跑不受影响）。

端到端浏览器验证（真实 4K 图发送、agent 读盘）待用户在远端设备更新后确认，不阻塞关闭——决策逻辑与降级路径已有测试证据。

毕业回写：产品行为（压缩阈值、分块兑底）→ `spec/agent-conversation.md`「图片与附件发送」；Relay 帧预算换算与线上报错不在仓库源码的事实 → `notes/003-relay-frame-budget-and-large-payloads.md`。压缩参数（1 MiB/2048px/q0.85）属可从代码重建，留在代码。

遗留：各 provider 对路径图片的视觉输入能力差异（Claude Code 可 Read 读图，其余未逐一验证）——影响的是分块兑底路径下非 Claude provider 的体验，压缩主路径不受影响；需要时另开 issue。
