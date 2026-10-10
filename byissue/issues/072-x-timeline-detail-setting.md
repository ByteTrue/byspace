---
kind: issue
title: 合并时间线显示设置为四档并让流式思考跟随滚动
type: feature
created: 2026-10-10
---

# 合并时间线显示设置为四档并让流式思考跟随滚动

## 目标

设置页把「Always expand reasoning」开关与「Tool call display」下拉合并为一个四档设置，同时修复展开的思考块在流式输出时滚动条不跟随最新内容的问题。

四档语义（用户拍板）：

| 档位                                | 值         | 工具调用                   | 思考块         |
| ----------------------------------- | ---------- | -------------------------- | -------------- |
| Collapse all / 全部折叠             | `overview` | 概览分组（现 Summary）     | 折叠           |
| Collapse details / 折叠详情         | `detailed` | 逐行展开（现 Full detail） | 折叠           |
| Show latest thinking / 显示最新思考 | `live`     | 同上                       | 仅最后一条展开 |
| Expand all / 全部展开               | `expanded` | 同上                       | 全部展开       |

迁移：`autoExpandReasoning=true` → `expanded`；`toolCallDetailLevel: "overview"` → `overview`；`"detailed"`（或缺省）→ `detailed`。默认值 `detailed`（与现默认一致）。

## 设计

- `AppSettings` 新字段 `timelineDetailLevel`，旧 `autoExpandReasoning` / `toolCallDetailLevel` 从 `AppSettings` 移除，存储 schema 保留旧字段做读取迁移（COMPAT 标记）。
- 投影层 `prepareToolCallHistory` / `projectToolCallDetailLevel` 继续吃 `"overview" | "detailed"`，view 层用 `toToolCallDetailLevel()` 收敛。
- 「最后一条思考」= history + liveHead 里最后一个 `kind: "thought"` 的 item；`ThoughtSlot` 的 `defaultExpanded` 变化时通过 key 重挂载应用（沿用 collapseRevision 的既有机制），完成态思考重挂载立即显示全文不重播 reveal。
- 思考详情内容渲染为专用 `ThinkingDetailSection`：滚动容器贴底跟随（onContentSizeChange + scrollToEnd），用户上滚即停止跟随、回到底部恢复；完成态内容不再增长因此不受影响。
- 设置页删掉开关行，下拉四选项复用现有 DropdownMenu 模式。

## 执行痕迹

按设计实现，无结构偏差。两点实现备注：

- **折叠回放**：`ToolCall` 的 `isExpanded` 是挂载时初始化的内部 state，`defaultExpanded` 变化对已挂载行无效；沿用 collapse-all 的既有机制——思考行 key 加入 `expandedThinkingRevision`（档位切换与 live 跟随换目标时 +1）强制重挂载。完成态思考重挂载经 useRevealedText 的 complete 相位立即显示全文，不重播动画。
- **贴底跟随**：`ThinkingDetailSection`（tool-call-details.tsx）仅在 `toolName === "thinking"` 分支启用；onScroll 记录是否在底部 32px 内，onContentSizeChange 时贴底 `scrollToEnd`。用户上滚即松开跟随，滚回底部恢复；followTail 随 status ready 翻转时重置 pin，重新展开从头跟随。
- 附带：mock load-test provider 增加 `mockReasoningRepeat` featureValue（镜像 mockAssistantResponse 模式），e2e 需要足够长的思考文本撑出滚动溢出。

改动文件：hooks/use-settings/{storage,index}.ts、agent-stream/view.tsx、components/{message,tool-call-details}.tsx、screens/settings/appearance/appearance-section.tsx、i18n/resources/\*.ts（9 locale）、hooks/use-settings/storage.test.ts、e2e/browser/timeline-detail-level.spec.ts（新增）、e2e 三个 spec 的 settings key、server mock-load-test-agent.ts。

## 评审轮（代码评审 + 过渡工程审查，均通过子代理执行）

结论均为可合/无大块可砍。按 review 落地五条（快改通道）：

1. **声明式 key 重挂载**（view.tsx）：删 `expandedThinkingRevision` state 与两个 bump effect，key 改为 `{collapseRevision}:{level}:{live 且是最新}`。消除挂载期空转重挂、切 live 双递增、换目标一帧双展开闪烁；顺带把 retarget 重挂缩到受影响的行，非最新行的手动展开不再被抹掉（评审观察项一并解决）。
2. **latestThoughtId 零分配遍历**（view.tsx）：先倒序扫 liveHead 再扫 history，去掉每 token 的 O(N) 数组拷贝。
3. **TIMELINE_DETAIL_LEVELS 归一**：常量留在 storage.ts（类型旁），设置页删本地副本改 import。
4. **memo 比较器死条件**（message.tsx）：followTail 比较去掉恒真的 defaultExpanded gate。
5. **ThinkingDetailSection pin 重置合一**：render 期重置并入 [followTail] effect。

评审确认不砍的（留档）：贴底跟随无现成轮子（maintainVisibleContentPosition web 不稳且语义不符；bottom-anchor 是整条 transcript 的重状态机）；重挂载优于 defaultExpanded 同步 effect（后者覆盖手动折叠）；mockReasoningRepeat 镜像既有模式；旧组合 autoExpand+overview → expanded 的有损映射符合拍板迁移表（验收留意）。

## 验证

- 首轮：`npm run typecheck` 全绿；lint 9 个改动文件 0 warnings 0 errors；biome format 已跑。
- 单测：storage.test.ts（77，含新增的 legacy 迁移四例）、resources.test.ts（34，locale key 对齐）、projection.test.ts 全绿。
- e2e（Playwright，真实 daemon + mock agent）：新增 `timeline-detail-level.spec.ts` 两例通过——① overview 下思考全折叠 / expanded 下全展开；② live 下恰好最新一条展开且滚动区贴底（tailDistance ≤ 40px）、上滚后新内容不再拽回。回归：tool-call-shimmer、tool-call-overview-sheet、agent-stream-ui 的 auto-scroll 三例全过。
- 评审轮后复验：typecheck 全绿、lint 0 错、storage/resources/projection 单测 128 通过、timeline-detail-level.spec 两例重跑通过（声明式 key 行为不变）。

## 关闭结论

用户确认免真机验收，授权关闭并开 PR（main）。关闭判断：目标四条（合并设置、四档语义、live 档仅最新展开、贴底跟随）全部兑现且有两轮评审与自动化证据；范围未暗扩；无必须处理的评审项。回写位置：无——设置项行为可从代码重建，不满足 spec 准入判据；被排除方案留档于本 issue「评审确认不砍的」。遗留：live 档下按「全部折叠」后，下一个新思考块仍会自动展开（符合该档「跟随最新」契约，未做抑制位；需要时新开 issue）。

- UI 折叠态与四档下拉的真实视觉确认待用户验收。

## 关闭候选

- spec：设置项行为是否进 project spec 待定（倾向不进，代码可重建）。
- notes：暂无外部事实。
