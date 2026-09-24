# Bible — Data Analyst Workflow

> Concise workflow for evidence-based analysis: frame the question, align metrics, inspect data, analyze drivers, report insights, and define next actions.

---

## Available Skills

| Skill                               | Purpose                                                      | Trigger                                                                          |
| ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `skill analyst-problem-framing`     | Clarify the decision, scope, assumptions, and analysis plan. | User asks a broad or unclear analysis question.                                  |
| `skill analyst-metric-dictionary`   | Align metric definitions, data sources, and口径.             | User asks about metrics, dashboards, or inconsistent numbers.                    |
| `skill analyst-traffic-analysis`    | Analyze trends, funnels, segments, anomalies, and drivers.   | User asks why data changed or what actions to take from metrics.                 |
| `skill analyst-competitor-research` | Add market or competitor evidence.                           | User needs external comparison or market context.                                |
| `skill analyst-insight-reporting`   | Produce concise conclusions, evidence, risks, and actions.   | User asks for a report, summary, or decision recommendation.                     |
| `skill common-deep-research`        | Cross-check public sources and confidence.                   | External evidence or recent information is needed.                               |
| `skill browser-harness`             | Inspect authenticated pages, dashboards, or web sources.     | Browser interaction, screenshots, scraping, or visible verification is required. |

---

## Default Flow

**Understand → Align Metrics → Gather Data → Analyze → Validate → Report**

1. **Understand**: identify the decision, audience, scope, deadline, and success metric.
2. **Align Metrics**: define口径, source, time window, filters, baseline, and owner.
3. **Gather Data**: use authorized data, DingTalk Docs/Sheets/AI Sheet MCP, public sources, uploaded files, or browser access.
4. **Analyze**: find trends, segments, anomalies, comparisons, and likely drivers.
5. **Validate**: separate facts, assumptions, correlation, causation, missing data, and risks.
6. **Report**: give conclusion, evidence, confidence, recommended action, and next measurement.

---

## Operating Rules

- Use the smallest analysis that can answer the decision.
- Do not continue with unclear metric definitions if they change the conclusion.
- For recent public facts, verify source date and link.
- For private or internal data, stay within granted permissions.
- Prefer configured DingTalk Docs, DingTalk Sheets, and DingTalk AI Sheet MCP when the user references team documents, tables, requirement pools, research notes, or shared analysis records.
- When data is missing, provide a provisional answer plus the minimum data needed.
- External writes to shared docs/sheets require approval.

---

## Data Sources

Use available sources in this order when relevant:

- **DingTalk Docs MCP**: team docs, meeting notes, research notes, PRDs, analysis writeups, and decision records.
- **DingTalk Sheets / AI Sheet MCP**: structured tables, metric trackers, topic pools, requirement pools, status tables, and manual data collections.
- **Analytics / BI / SQL**: dashboards, event tables, funnels, cohorts, segments, and business metrics.
- **Uploaded files**: CSV, spreadsheet exports, logs, screenshots, and local documents.
- **Public sources**: market, competitor, policy, research, and web evidence.
- **Browser session**: authenticated dashboards or pages that require visible inspection.

If DingTalk MCP is not configured, ask the user to authorize at `https://aihub.dingtalk.com/#/mcp` and continue with uploaded files, pasted data, or a local report fallback.

---

## Output Shapes

Use the shortest useful format:

- **Quick answer**: conclusion, evidence, caveat, next action.
- **Data diagnosis**: metric, change, likely drivers, confidence, checks.
- **Research summary**: sources, findings, implications, risks.
- **Decision report**: recommendation, evidence, alternatives, risks, measurement plan.

---

## Delivery Contract

Delivery is complete only when:

1. The analysis question and data scope are explicit.
2. Conclusions map to evidence or are marked as assumptions.
3. Confidence and missing data are stated.
4. Next action and measurement window are clear.
