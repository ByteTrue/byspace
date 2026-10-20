---
kind: decision
title: "采用 magpie 式单二进制 Go 架构，前端与协议沿用现有实现"
created: 2026-10-19
superseded-by: ""
---

# 采用 magpie 式单二进制 Go 架构，前端与协议沿用现有实现

**后端、CLI、Relay、MCP 桥统一收进一个零 CGO 的 Go 二进制，前端保留现有 `packages/app` 编译产物用 `//go:embed` 打进同一二进制。**
架构形态借鉴 magpie（单一 `main.go` 分发、领域能力全在 `internal/*`、一个 handler 长出所有载体），但每一处能力的行为逐条从 Node 版翻译。

## 为什么这样分

架构与行为是两回事，混在一起就会出错。magpie 提供的是**形状**：一个二进制、一套 internal 包、一个 handler 多副面孔。它不提供 BySpace 的行为语义——那些在 `packages/server` 里，必须逐条翻译，不能重新发明。

前端不重写是硬约束：`packages/app` 已经是完整产品，重写等于用「架构更优雅」换掉所有既有 UI 行为。所以前端只换交付方式（编成 JS 产物嵌入二进制），不换实现。

## 具体约束

- **零 CGO。** `CGO_ENABLED=0` 必须可编译，不引入 C/C++ addon（PTY 用 `creack/pty`，SQLite 若需要则纯 Go 驱动）。
- **协议与加密不动。** WebSocket 消息仍受 `@bytetrue/protocol` 的 schema 约束；E2EE 用 `golang.org/x/crypto/nacl/box`，与前端 `tweetnacl` 字节级兼容。
- **落盘格式不动。** Go 版直接读写 `$BYSPACE_HOME` 现有 JSON，两版可共用同一个 home 目录随时切换对比。
- **不做桌面壳。** 桌面与原生移动已在 issue 025 退役，不因换语言复活。当前四副面孔：`serve` / `web` / `relay` / CLI。
- **行为必须翻译，不许发明。** 见下方「已知的偏离坑」。

## 背景（已知的偏离坑）

这条约束不是抽象的：实现过程中出现过六次「翻译不下去就自创实现」的情况，每次都由 owner 在实测中发现：

| 位置               | 自创的                              | Node 的实际行为                            |
| ------------------ | ----------------------------------- | ------------------------------------------ |
| agent timeline     | 落盘 `agents/timelines/*.json` 快照 | 纯内存 store，历史由 provider 会话文件重建 |
| `process_exit`     | 发 `turn_completed` 并保留 runtime  | `turn_failed` + `closeAgent` 摘除 runtime  |
| `steer`            | 有 `steer` 就无条件下发             | 先查活跃轮次，无则 `inactive` → 开新轮次   |
| pairing QR         | SHA-256 伪随机矩阵（扫不出来）      | `qrcode` 包生成真 QR                       |
| skills status      | 硬编码 `up-to-date`                 | 三态 + 逐 op `targets`                     |
| 内置 provider 列表 | 把 ACP 预设当常驻内置项             | 6 个内置 + `+ Add provider` 按需挂载       |

结论：新增实现时，Node 有对应物就必须指出对应文件；确实属于新增设计的，要显式标注，不能混在翻译里。

讨论过程见 `../talks/008-go-rewrite-architecture-inspiration.md`；全量对齐范围见 `../epics/2026-10-19-o-go-single-binary-full-parity/spec.md`。
