---
name: analyst-insight-reporting
description: 分析任务收尾，需要给决策方交付“可行动 + 可追溯”的结论。
---

# Skill — 证据化结论报告

| 字段     | 内容                      |
| -------- | ------------------------- |
| skill_id | analyst-insight-reporting |
| 状态     | ready                     |

## 触发

- 分析任务收尾，需要给决策方交付“可行动 + 可追溯”的结论。

## 输入

- 必需：关键发现、证据来源、数据质量结论。
- 可选：历史验证结果、冲突证据、业务优先级。

## 执行

1. 组织“结论-证据-置信度-风险-行动”结构。
2. 为每条结论标注 High/Medium/Low 与依据。
3. 输出“当前可决策项 / 待验证项”分层清单。

## 输出

- 证据化报告、置信度标签、待验证清单、下一步动作。

## 守则与降级

- 不允许无依据给 High 置信度。
- 证据冲突时默认降级并显式说明冲突点。

## 依赖分级（MCP / Connector）

- 强依赖：无（可基于已有材料产出文本版报告）。
- 弱依赖（可增强）：`Reporting Workspace（Google Sheets / Feishu Bitable / Looker Studio）`、`Web Search & Research（WebSearch / SerpAPI / Tavily）`。

## 能力分层

- **Basic**：输出文本化证据报告与保守版置信度。
- **Supercharged**：结合看板与外部验证源，输出更动态的置信度校准结果。

## Supercharged 激活条件（必须满足）

- MCP：`Reporting Workspace（Google Sheets / Feishu Bitable / Looker Studio）` 或 `Web Search & Research（WebSearch / SerpAPI / Tavily）` 至少可用 1 项。
- Connector：`Reporting Workspace（Google Sheets / Feishu Bitable / Looker Studio）` 为可选增强；仅走 WebSearch 路径时不强制。
- 若上述条件不满足：仅输出 Basic 层结果，不输出 Supercharged 结论。

## 分层执行步骤

### Basic

1. 汇总结论并按业务影响排序。
2. 给每条结论标注置信等级和原因。
3. 输出“可立即执行动作 + 待补证据项”。

### Supercharged

1. 用看板快照或外部来源补充关键证据。
2. 根据新增证据调整置信等级。
3. 生成“决策摘要 + 执行清单 + 监控位点”。

## 降级逻辑（非技术化表达）

- 当看板或外部验证暂不可用时：先交付“保守版可执行结论”，并说明“先小步验证，补证据后再升级决策力度”。

## Few-shot 示例

- 示例 1（国内 SaaS 周报）  
  输入：“给老板一版本周增长结论，顺带标注把握度。”  
  Basic 输出：四段式结论 + 置信度标签。  
  Supercharged 输出：附看板快照与待补证据优先级。
- 示例 2（海外团队月报）  
  输入：“Give me a decision-ready summary for CMO.”  
  Basic 输出：核心结论与风险分层。  
  Supercharged 输出：补外部验证后给可决策项/暂缓项。
