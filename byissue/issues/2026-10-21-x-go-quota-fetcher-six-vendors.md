---
kind: issue
title: "Quota fetcher 只实现 codex/zai 两家，其余 6 家需要真实凭据"
type: feature
created: 2026-10-21
---

# Quota Fetcher 剩余 6 家

> **读者：** 手上有这些厂商账号、愿意提供凭据来验证抓取逻辑的人。

## 现状

`internal/quota` 的框架（manifest / provider / usage）已落地，两家能跑：

| 厂商    | 状态   | 说明                                                                                                  |
| ------- | ------ | ----------------------------------------------------------------------------------------------------- |
| codex   | 已实现 | 读 `~/.codex/auth.json`，**只读不刷新**——刷新归 codex CLI 管，两个 daemon 轮换同一 token 会把用户登出 |
| zai     | 已实现 | 同上模式                                                                                              |
| claude  | 未实现 | 需真实凭据                                                                                            |
| cursor  | 未实现 | 需真实凭据                                                                                            |
| copilot | 未实现 | 需真实凭据                                                                                            |
| grok    | 未实现 | 需真实凭据                                                                                            |
| kimi    | 未实现 | 需真实凭据                                                                                            |
| minimax | 未实现 | 需真实凭据                                                                                            |

缺凭据时 `provider.usage.list` 返回 `unavailable` 而不是 `error`——这两件事对用户意味着
不同的事（「没配」vs「配了但抓不到」），UI 也分开显示。

## 为什么当时没做

六家的抓取逻辑各自是一套 HTTP + 凭据解析，而**没有真实凭据时无法验证**。盲写的抓取器会
静默返回错误数字，比「显示 unavailable」更糟——用户会以为自己额度还剩很多。

## 每家实现前要确认的

1. 凭据在哪（配置文件路径 / 环境变量 / keychain），格式是什么。
2. 有没有官方 API；没有的话抓哪个页面、解析什么字段。
3. 额度是「剩余」还是「已用」，单位是 token 还是请求数。
4. 刷新 token 的副作用：**是否会影响用户自己的 CLI 登录**（codex/zai 选择只读就是这个原因）。

## 验收

拿真实凭据跑一次，把抓到的数字与厂商控制台显示的对照。数字对不上就是没做对——这类
功能「接口通了但数字错」是最常见的失败方式。

## 参考

- 已有实现：`internal/quota/`（`codex`、`zai` 与框架）
- Node 实现：`archive/packages/server/src/services/quota-fetcher/providers/*.ts`（8 个文件）
- 台账：同上 MISSING 表

## 验收与关闭

已关闭，**验收条件（真实凭据对数字）未满足**：

- 八家全部注册（claude / codex / copilot / cursor / grok / kimi / minimax / zai），与 Node 的 `providers/` 一一对应。
- 统一标记 `PORTED-UNVERIFIED`：实现照写，测试覆盖参数解析与形状处理（形状不符返回 `unexpected shape` 而不是编一个数字）。
- **未验证**：拿真实凭据跑一次并与厂商控制台对账。本机没有这八家的凭据。

这条的本意正是「接口通了但数字错是最常见的失败方式」——所以我不会把它记成已验证。
