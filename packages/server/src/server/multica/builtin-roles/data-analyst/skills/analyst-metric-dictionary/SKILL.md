---
name: analyst-metric-dictionary
description: 指标定义冲突，或同一指标存在多版本口径。
---

# Skill — 指标口径对齐

| 字段     | 内容                      |
| -------- | ------------------------- |
| skill_id | analyst-metric-dictionary |
| 状态     | ready                     |

## 触发

- 指标定义冲突，或同一指标存在多版本口径。

## 输入

- 必需：指标列表、数据来源、统计窗口。
- 可选：历史口径版本、业务规则。

## 执行

1. 对齐指标定义、分子分母和统计窗口。
2. 标注不可比项和变更影响范围。
3. 形成口径字典并版本化。

## 输出

- 指标字典、口径版本、不可比项提示。

## 守则与降级

- 口径冲突未解前，不输出横向比较结论。
- 无法统一时，分别输出并注明不可比。

## 依赖分级（MCP / Connector）

- 强依赖：`Analytics & BI（GA4 / Mixpanel / Amplitude / BigQuery / Looker） / SQL`（若要做正式口径统一）。
- 弱依赖（可增强）：`Sheets`、`Reporting Workspace（Google Sheets / Feishu Bitable / Looker Studio）`（用于对齐结果沉淀）。

## 能力分层

- **Basic**：在无数据直连时，先统一“定义层口径”（指标公式、统计窗口、分组维度）。
- **Supercharged**：基于真实数据表核对字段映射与历史口径差异，并落地版本化字典。

## Supercharged 激活条件（必须满足）

- MCP：`Analytics & BI（GA4 / Mixpanel / Amplitude / BigQuery / Looker） / SQL`（必需），`Sheets`（可选增强）。
- Connector：`Analytics & BI（GA4 / Mixpanel / Amplitude / BigQuery / Looker）`（必需），`Reporting Workspace（Google Sheets / Feishu Bitable / Looker Studio）`（可选增强）。
- 若上述条件不满足：仅输出 Basic 层结果，不输出 Supercharged 结论。

## 分层执行步骤

### Basic

1. 明确每个指标的分子、分母、时间窗。
2. 标记易混淆定义（如 DAU、活跃客户、付费用户）。
3. 给出“可比 / 不可比”结论。

### Supercharged

1. 读取数据表结构和历史报表口径。
2. 对齐字段映射并检查计算口径漂移。
3. 输出版本化口径字典并附影响说明。

## 降级逻辑（非技术化表达）

- 当核心数据表暂时接不上时：先交付一版“定义与口径草案”，提醒“这版先保证团队说的是同一件事，数据接入后再做精确校对”。

## Few-shot 示例

- 示例 1（国内电商）  
  输入：“我们内部对 GMV 和实收金额总对不上，先统一口径。”  
  Basic 输出：给出 GMV/实收/退款净额的定义差异。  
  Supercharged 输出：基于订单表 + 退款表给出可执行口径版本表。
- 示例 2（海外 SaaS）  
  输入：“MRR 口径不同团队算得不一样。”  
  Basic 输出：定义新签/扩容/流失 MRR 组成。  
  Supercharged 输出：按 Stripe/Billing 字段映射生成统一公式。
