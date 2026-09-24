---
name: analyst-competitor-research
description: 需要做市场对标、定位评估，或自然流量/关键词趋势判断。
---

# Skill — 竞品与搜索趋势研究

| 字段     | 内容                        |
| -------- | --------------------------- |
| skill_id | analyst-competitor-research |
| 状态     | ready                       |

## 触发

- 需要做市场对标、定位评估，或自然流量/关键词趋势判断。

## 输入

- 必需：研究问题、竞品名单或关键词主题。
- 可选：目标市场、观察窗口、页面分组、设备/地域维度。

## 执行

1. 明确研究边界并定义对比维度（定位、定价、渠道、搜索表现）。
2. 收集公开资料与搜索信号，构建“竞品-主题-机会”矩阵。
3. 标注确定项与待验证项，给出优先验证路径。

## 输出

- 竞品画像、搜索趋势洞察、机会矩阵、验证动作。

## 守则与降级

- 不以单一来源下强结论，关键结论必须可追溯。
- 数据窗口不足时显式标注“观察期限制”。
- 涉及复杂多源研究时，优先调用 `common-deep-research` 形成证据底稿。

## 依赖分级（MCP / Connector）

- 强依赖：无（可基于已知资料先产出）。
- 弱依赖（可增强）：`Web Search & Research（WebSearch / SerpAPI / Tavily）`、`Market Intelligence（Similarweb / Ahrefs / Semrush）`、`Google Search Console`。

## 能力分层

- **Basic**：基于现有信息做竞品与搜索趋势的结构化初判。
- **Supercharged**：多源检索与交叉验证后输出高置信机会窗口。

## Supercharged 激活条件（必须满足）

- MCP（满足其一即可）：
  - 路径 A：`WebSearch` 或其他互联网搜索工具可用；
  - 路径 B：`Market Intelligence（Similarweb / Ahrefs / Semrush）` 或 `Google Search Console` 可用。
- Connector：
  - 路径 A：不强制；
  - 路径 B：`Market Intelligence API（Similarweb / Ahrefs / Semrush）` 或 `Google Search Console` 至少可用 1 项。
- 若上述条件不满足：仅输出 Basic 层结果，不输出 Supercharged 结论。

## 分层执行步骤

### Basic

1. 按统一维度整理竞品差异与搜索主题分组。
2. 给出“确定项/待验证项”与初步机会假设。
3. 输出短期可执行验证动作。

### Supercharged

1. 扫描公开情报与搜索表现数据。
2. 对关键结论做交叉验证并消解冲突信息。
3. 输出机会优先级、风险点和后续监测清单。

## 降级逻辑（非技术化表达）

- 当外部情报不足时：先交付“可执行初判版”，并明确“哪些判断需要后续补证据再升级为强结论”。

## Few-shot 示例

- 示例 1（国内协作工具）  
  输入：“我们和飞书、钉钉、企业微信怎么差异化？顺便看品牌词趋势。”  
  Basic 输出：差异矩阵 + 趋势初判。  
  Supercharged 输出：补充公开流量与关键词信号后给优先突破点。
- 示例 2（海外 AI 工具）  
  输入：“Compare us with Notion AI/Jasper and check organic signal.”  
  Basic 输出：定位与功能对比。  
  Supercharged 输出：补 SEO/流量信号后给机会窗口。
