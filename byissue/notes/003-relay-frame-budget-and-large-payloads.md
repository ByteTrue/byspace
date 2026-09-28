# Relay 单帧预算与大 payload 设计

## 事实

- Relay 对单个 WebSocket 帧的硬上限是 **32 MiB**（wire 尺寸）。公开源码里没有这条检查——它在线上部署的 Cloudflare Relay worker 里，报错文案 `Relay frame exceeds size limit` 不在本仓库源码与 git 历史中，全库搜索搜不到是正常的。
- 帧内容走 E2EE：明文 JSON → 加密（+40 B 开销）→ base64（×4/3）。换算公式在 `packages/relay/src/encrypted-channel.ts` 的 `maxBase64EncryptedPlaintextByteLength`；32 MiB wire ≈ **24 MiB 明文**预算。
- `send_agent_message` 与 `create_agent` 把正文 + 全部内联图片打成**一个**帧，所以预算是整条消息共享的，不是每张图各自的。
- 既有分块通道：`uploadFile` 走 `FileBegin/FileChunk/FileEnd` 二进制帧、1 MiB/块，落盘 `<byspaceHome>/uploads/<id>/<fileName>`，作为 `uploaded_file` 附件时 prompt 只渲染路径不内联内容。

## 坑

- 估算 payload 预算时用 base64 字符串的 `.length` 当 wire 单位即可（wire 就是 base64），不要先解码成字节再算；`data.length` 是解码后字节数的 4/3。
- 给大 payload 做兜底时，"上传失败回退到旧行为"比"上传失败就丢"安全——旧行为（撞帧上限报错）是地板，新通道是改进。
- 新增大 payload 功能先问：这个总量会不会一个帧放不下？放不下的部分有没有现成的分块通道可指？
