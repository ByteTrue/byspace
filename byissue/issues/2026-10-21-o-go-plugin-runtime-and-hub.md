---
kind: issue
title: "Go 侧 plugin 运行时与 hub 远程控制未实现"
type: feature
created: 2026-10-21
---

# Plugin 运行时与 Hub

> **读者：** 接手「第三方插件」或「多主机 hub」的人。

## 现状

- `plugin.*` 的**只读端**如实返回空目录，**写端**明确回
  `plugin runtime is not available on this daemon build`。没有假装成功。
- `hub.*` 返回 `not_connected`，权限表已就位。
- `server_info.features` 里 `plugins` / `pluginManagement` / `pluginGitManagement` /
  `pluginLogs` / `pluginThemes` / `pluginSettings` / `pluginTimelineItems` /
  `hubAgentRpc` / `hubRelationship` 本轮全部改为 `false`（此前声明为 `true`）。

## 这两个是不同的东西

|        | plugin                                                         | hub                                                    |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------ |
| 是什么 | 在 daemon 里跑第三方代码，能改 UI 主题、加时间线条目、加设置页 | daemon 之间互相注册，一台机器上的 agent 能被另一台驱动 |
| 难点   | 沙箱与信任边界；Node 用 `pluginrt`/`plugin` 两个包             | 身份与授权模型；已有一张 hub 权限表但没有执行层        |

## 验收

- plugin：装一个只读插件，主题生效；装一个行为异常的插件，daemon 不受影响（沙箱有效）。
- hub：两台 daemon 互连后，A 上的 agent 能被 B 创建与驱动，权限按 hub 表生效。

## 参考

- Node 实现：`archive/packages/server/src/server/plugin*`、`hub*`
- 权限表：`internal/authz/table.go`
- 台账：同上 MISSING 表
