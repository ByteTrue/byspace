---
kind: issue
title: "内建 agent provider 收缩：只留 claude/codex/opencode/pi/omp"
type: chore
created: 2026-10-10
---

<!-- 读者：跨会话接手的人。目标与范围 · 影响面 · 风险 · 验证 · 关闭回写 -->

# 内建 agent provider 收缩：只留 claude/codex/opencode/pi/omp

## 为什么做

从 [025 架构审计](025-x-architecture-retention-audit.md) 的 C11 抽取（原批次 7）。026 方向放弃后 BySpace 独立发展，同时维护七个 ACP 适配器的成本不再有对应价值；用户适配新 agent 的路径是 config.json custom provider（ACP / 自定义二进制 / API 端点 / profiles，独立于插件系统）+ skill/提示词指导。

**Owner 已确认收缩方向（2026-09-11，025 C11），待执行。**

## 范围

**保留：** claude、codex、opencode、pi、omp。

**移除：** cursor、kimi、kiro、trae、copilot、generic ACP、mock load test 等其余内建适配器。

**不动：** provider 注册框架（provider-registry.ts 的结构）；custom provider 系统；app 侧 provider 展示的通用机制。

## 影响面（2026-10-10 预扫，实现时以实际为准）

- packages/server/src/server/agent/provider-registry.ts：7 个 import + 注册项。
- packages/server/src/server/agent/providers/：cursor-acp-agent.ts、kimi-acp-agent.ts、kiro-acp-agent.ts、trae-acp-agent.ts、copilot-acp-agent.ts、generic-acp-agent.ts 及其测试与 smoke 测试。
- **mock 例外（待确认）：** mock-load-test-agent.ts 与 mock-slow-provider.ts 是活测试基础设施——selective-timeline-delivery.e2e.test.ts、workspace-same-cwd-isolation.e2e.test.ts 直接消费。C11 原文列其移除，但移除会破坏这两条 e2e；实现时须先确认替代（换 mock 挂载点）或改判保留为测试专用。
- 文档与宣传位：README.md / README.zh-CN.md（"Claude Code, Codex, Copilot, OpenCode, and Pi" 措辞）、CLAUDE.md 的项目说明、public-docs/supported-providers.md、public-docs/providers.md、public-docs/custom-providers.md、public-docs/metadata-generation.md。
- app 侧 brand 相关：实现时以 rg -li 'copilot|cursor|kimi|kiro|trae' packages/app/src --glob '!_.test._' 重新扫（预扫有 8 个文件命中，多为宽泛匹配，须逐个核实是否真属被移除 provider）。
- provider-availability / provider-image-output 等共享测试面是否含被移除 provider 的断言。

## 风险

- 已配 cursor/kimi/kiro/trae/copilot 的用户配置在移除后需能通过 custom provider 复现同等连接；文档要给出等价迁移路径（custom-providers.md 已有模板）。
- 移除 generic ACP 后，「无内置适配器的 ACP agent」接入只能走 custom provider——实现时确认 custom provider 的 ACP 路径覆盖与原 generic ACP 等价的配置面。

## 验证（实现批次时落地）

- 移除后全 workspace typecheck / lint / format 全绿；provider 相关单测按保留清单收敛。
- 被移除 provider 的字符串在活代码与活文档零命中（byissue 历史与 CHANGELOG 除外）。
- daemon 启动 + 保留 provider 各创建一次 agent 冒烟。
- 两条消费 mock 的 e2e：按上面的处置结论，要么仍绿，要么明确记录了替代方案。

## 决策记录

- **2026-09-11** 025 C11：Owner 确认收缩方向，列为待执行批次。
- **2026-10-10** 从 025 抽取成独立 issue；025 据此关闭。mock 的测试基础设施身份为新发现，列为实现时首要确认项。
