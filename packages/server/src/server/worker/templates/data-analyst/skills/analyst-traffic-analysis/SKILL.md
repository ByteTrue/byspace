---
name: analyst-traffic-analysis
description: 增长数据出现波动，或用户要求“先判断数据可用性，再定位异常与瓶颈”。
---

# Skill — 数据诊断与归因闭环

| 字段     | 内容                     |
| -------- | ------------------------ |
| skill_id | analyst-traffic-analysis |
| 状态     | ready                    |

## 触发

- 增长数据出现波动，或用户要求“先判断数据可用性，再定位异常与瓶颈”。

## 输入

- 必需：关键指标、时间窗口、漏斗定义或目标动作。
- 可选：渠道维度、活动日历、系统变更记录、样本截图。

## 执行

1. 先做数据质量体检（完整性、一致性、时效性）。
2. 在可用数据范围内定位异常区间与漏斗瓶颈。
3. 输出候选原因、验证路径与优先优化动作。

## 输出

- 质量结论、异常解释、漏斗诊断、行动优先级。

## 守则与降级

- 数据质量未达标时，先给风险边界再给结论。
- 证据不足时标注“候选原因”，不输出伪确定性归因。

## 依赖分级（MCP / Connector）

- 强依赖：`Analytics & BI（GA4 / Mixpanel / Amplitude / BigQuery / Looker）`（做正式诊断时）。
- 弱依赖（可增强）：`Google Search Console`、`Reporting Workspace（Google Sheets / Feishu Bitable / Looker Studio）`（排查留痕）。

## 能力分层

- **Basic**：基于已有报表或样本数据完成“质量体检 + 异常定位 + 漏斗初判”。
- **Supercharged**：结合多维实时数据做更细粒度归因，并输出更高置信优化序列。

## Supercharged 激活条件（必须满足）

- MCP：`Analytics / BI / SQL（GA4 / Mixpanel / Amplitude / BigQuery）`（必需）。
- Connector：`Analytics & BI（GA4 / Mixpanel / Amplitude / BigQuery / Looker）`（必需）；`Google Search Console`（可选增强）。
- 若上述条件不满足：仅输出 Basic 层结果，不输出 Supercharged 结论。

## 分层执行步骤

### Basic

1. 检查关键字段与口径是否可比，给出“可用/谨慎/不可用”判断。
2. 识别异常时间段、流失节点与候选影响维度。
3. 输出最短排查路径和优先修复动作。

### Supercharged

1. 拉取分渠道、分页面、分人群数据并联动活动日志。
2. 逐条验证候选原因，排除无效假设。
3. 输出高置信归因结论、风险等级和提效优先级。

## 降级逻辑（非技术化表达）

- 当细分数据暂时缺失时：先交付“当前能确认的影响范围 + 可先执行动作”，并说明“更细颗粒度结论会在数据补齐后补发”。

## Few-shot 示例

- 示例 1（国内内容平台）  
  输入：“公众号投放后，注册转化变差，帮我从数据可用性开始排查。”  
  Basic 输出：先给字段缺失风险，再定位主要流失段。  
  Supercharged 输出：联动渠道和活动日志定位主因并给修复顺序。
- 示例 2（海外 DTC）  
  输入：“Google Ads 流量涨了但购买没涨，怎么拆？”  
  Basic 输出：给漏斗流失点与候选原因。  
  Supercharged 输出：拆到 campaign/ad group/landing page 级并给优先动作。
