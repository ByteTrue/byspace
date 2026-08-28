---
kind: issue
title: "建立 TypeScript↔Go 首轮协议契约"
type: feature
status: closed
created: 2026-08-27
---

# 建立 TypeScript↔Go 首轮协议契约

## 做成以后

同一组提交到仓库的 golden fixtures 同时被现有 TypeScript schema/codec 与新的 Go 协议包消费。首轮 Go daemon 可以据此完成 hello、Agent 列表/创建/发送/Timeline 的 JSON 边界，并能精确识别以后终端与文件能力要沿用的二进制 wire 格式，而不靠阅读两份独立实现猜测协议。

这组夹具是 byspace 内部迁移契约，不承诺永久兼容全部 Paseo 客户端或一次覆盖整个现有协议。

## 范围与边界

**本轮固定：**

- client→daemon：`hello`、`ping`、Agent 列表、创建、Timeline 获取和发送消息请求；
- daemon→client：`pong`、server-info、空 Agent 列表、Agent 创建成功、空 Timeline、消息接受和 assistant Timeline 流事件；
- 二进制：terminal output/resize 与 file begin/chunk/end；
- 共享无效向量：未知消息类型、缺失必填关联字段、畸形/截断二进制帧；
- 混合版本规则：未知对象字段被接受且不参与当前语义；未知 envelope/message discriminant 被拒绝。

**本轮不做：**

- 实现 WebSocket server、daemon 进程、CLI 或持久化；
- 实现完整 Agent snapshot/list/timeline 领域模型；夹具只覆盖首轮闭环所需投影；
- 更改现有 TypeScript wire 名称，或承诺 stock Paseo 客户端长期兼容；
- 实现 Relay 加密、Hub、终端 PTY 或文件系统操作；二进制仅固定 codec。

## 实现方案

1. 在根 `fixtures/protocol/v1/` 保存语言无关的 JSON wire 文件和十六进制二进制向量，固定字段、字节序、长度前缀与错误样例。
2. 在 `packages/protocol` 增加 fixture contract test：现有 Zod schema 必须接受有效/兼容样例、拒绝无效样例；现有二进制 codec 必须逐字节得到相同向量并可解码。
3. 在独立的 `go/` 目录建立无外部依赖的 Go module 和 `internal/protocol`：避免根 module 的 `go test ./...` 误扫 npm 依赖携带的 Go 源码；JSON 信任边界只解码本轮 client 消息，server 侧只编码本轮输出；未知字段由标准 JSON decoder 忽略，未知类型返回有界错误。
4. Go 二进制 codec 使用标准库实现与 TypeScript 相同的 opcode、slot、UTF-8 request ID、big-endian metadata length 和 JSON payload。
5. Go tests 读取同一 fixture 目录，验证有效 round-trip、兼容输入与无效边界，不复制第二套测试数据。

Go module 暂用本地 module path `byspace`，因为公共仓库 URL 尚未确认；在任何外部 Go import 或首次公开发布前，必须一次性改为最终路径，不能让临时路径进入对外契约。

## 风险穿刺

| 风险                                      | 怎样算打通                                                         |
| ----------------------------------------- | ------------------------------------------------------------------ |
| TS 与 Go 各自测试绿色但实际 wire 不同     | 两端读取仓库内同一 fixture，JSON 语义和二进制字节均一致            |
| Go `encoding/json` 把缺失字段静默变成零值 | 共享 invalid fixtures 对必填字段做显式 presence 验证               |
| 为兼容未来字段而接受未知消息动作          | 只忽略对象内未知字段；未知 envelope/message type 明确报错          |
| 二进制 metadata 长度或字节序偏差          | begin/chunk/end 与 terminal 帧均以固定 hex 向量逐字节比较          |
| 一次建模完整 Paseo schema 导致重写失控    | Go 类型只覆盖首轮闭环和已选二进制 codec；其余消息按后续 Issue 扩展 |

## 验收与质量证据

- `npm test --workspace=@byspace/protocol` 通过 fixture contract tests；
- `cd go && go test ./...` 通过，且 tests 从 `fixtures/protocol/v1` 读取数据；
- JSON valid/compat/invalid 和 binary valid/invalid 各至少有一条被 TS、Go 双端消费；
- `npm run typecheck`、`npm run build:web` 和现有完整测试基线保持绿色；
- Go runtime package 不依赖生成器、第三方 JSON 库或复制来的 Node server 代码。

## 实现与验证记录

2026-08-27 已完成实现：

- `fixtures/protocol/v1/` 包含 19 个 JSON wire fixtures（6 个 client valid、7 个 server valid、2 个 compat、4 个 invalid）和 11 个二进制向量（5 个 valid、6 个 invalid）；
- TypeScript contract suite 共 30 个 fixture cases，除通用 envelope 外还用具体 server-info / agent-created status payload schema 校验状态消息；
- `go/` 是独立、仅标准库的 module，`internal/protocol` 提供所选 client JSON 信任边界、server JSON encoder 与 terminal/file binary codec；`go list -m all` 只有本 module；
- 独立 review 找出的 Timeline cursor 对象、`limit: 0` 语义、非空 `clientId`、具体 status schema 和未知顶层 envelope 覆盖缺口均已修复并进入共享 fixtures；
- `go vet ./...`、`go test -race -cover ./...` 通过，语句覆盖率 74.5%；
- `npm run build:web && npm run typecheck && npm test && npm run lint && npm run test:browser` 整体 exit 0：当前单元/Worker 648 个 test files，5,697 passed、1 skipped；浏览器 11 个 test files / 103 tests 通过；lint 0 error、6 个既有 warning。

浏览器测试仍报告两处上游 `@vitest/browser/context` deprecated import，但当前测试通过，且该迁移不属于本协议 Issue。

## 关闭结论

实现、review 与验收目标均已达成，且没有把 WebSocket server、daemon、CLI 或持久化写成当时已有能力。共享 JSON/binary fixture 契约、Go module 边界与未知字段/type 策略已回写本 Epic `spec.md`。用户已授权关闭满足 review 与自测条件的既有 Issue，本 Issue 关闭。
