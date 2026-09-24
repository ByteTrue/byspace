---
name: common-deep-research
description: 对关键问题做多源研究、交叉验证和证据化归纳；不负责页面提交流程。
---

# Shared Skill — Deep Research（深度研究）

> 对关键问题做多源研究、交叉验证和证据化归纳；不负责页面提交流程。

| 字段     | 内容                 |
| -------- | -------------------- |
| skill_id | common-deep-research |
| 状态     | ready                |

## 依赖分级（MCP / Connector）

- 强依赖：无（可先基于用户提供材料运行）。
- 弱依赖（可增强）：`Search / Research`、`Market Intelligence`、`Analytics` 等研究型数据源。

## 能力分层

- **Basic**：用已有资料输出“结论草案 + 假设边界 + 待验证清单”。
- **Supercharged**：多源检索与交叉验证后，输出高可追溯的研究结论。

## Supercharged 激活条件（必须满足）

- MCP（满足其一即可）：
  - 路径 A：`WebSearch` 或其他互联网搜索工具（如 `Search / Research`）可用；
  - 路径 B：`Market Intelligence`、`Analytics` 中至少可用 1 项。
- Connector：
  - 路径 A：不强制；
  - 路径 B：需有对应研究型 Connector（如 `Market Intelligence API（Similarweb / Ahrefs / Semrush）`、`Analytics & BI（GA4 / Mixpanel / Amplitude / BigQuery / Looker）`）至少 1 项可用。
- 若上述条件不满足：仅输出 Basic 层结果，不输出 Supercharged 结论。

## 分层执行步骤

### Basic

1. 框定研究问题与决策背景。
2. 基于现有信息整理核心观点和不确定点。
3. 给出可执行建议与后续验证路径。

### Supercharged

1. 扩展检索到多类来源（官方、行业、第三方）。
2. 对关键结论做交叉验证和冲突消解。
3. 输出证据映射、置信度和行动建议。

## 降级逻辑（非技术化表达）

- 外部资料不足：提示“我先给你一版方向性结论，哪些点还需要补证据我会明确标出来”。
- 来源冲突：提示“目前有两种解释都成立，我会先告诉你各自适用条件，再给优先验证顺序”。

## Few-shot 示例

- 示例 1（中国大陆）  
  需求：“调研小红书和抖音哪个更适合我们这个新品冷启动。”  
  Basic：基于现有素材给平台匹配建议和待验证指标。  
  Supercharged：补充公开流量特征和竞品案例后给渠道优先级。
- 示例 2（境外）  
  需求：“Should we prioritize LinkedIn or X for B2B launch?”  
  Basic：先给受众匹配和内容形态建议。  
  Supercharged：加入行业基准与历史活动数据后给更稳妥结论。
