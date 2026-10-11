---
kind: issue
title: 修正 live 档的思考展开条件并新增「展开所有思考」档位
type: ff
created: 2026-10-11
---

# 修正 live 档的思考展开条件并新增「展开所有思考」档位

## 做了什么

用户报 live 档（显示最新思考）下：思考完成后接着跑工具调用，那条思考仍保持展开，被后出现的行挤在上面。根因在判定——原来取的是「时间线里最后一个 thinking」，只在 thinking 之间比谁最后，不看它后面还有没有别的 item，所以工具调用落到下面时展开态留在原地。

同时把显示档位从四档扩成五档，在「显示最新思考」与「全部展开」之间插入「展开所有思考」。原「全部展开」实际只作用于思考块（工具调用在任何档位都不自动展开），新档与它等价，因此按用户拍板让「全部展开」名副其实：同时自动展开工具调用详情，新档位承担「只展开思考」这一档。

## 改了哪些

- `packages/app/src/agent-stream/view.tsx`
  - `latestThoughtId` → `liveThoughtId`：只有「时间线最后一项是 thought」才返回它的 id，否则 null（折叠且不跟随）。
  - `renderSingleToolCallRow`：仅 `expanded` 档给工具行传 `defaultExpanded`/`forceInline`，key 带上档位与折叠状态。
  - `collapsedReasoningIds` → `collapsedDetailIds`，「全部折叠」的台账纳入工具行。没有这一步，新档次的自动展开会在每次重挂载（含全部折叠自己触发的重挂载）时把工具详情又打开。
  - 「全部折叠」的台账还要收 nested codemode 子行：这些行被投影从流里摘出去、挂在父行下面渲染，不在 `streamLayout` 里，只按布局收集会漏掉它们。`agent-stream-ui` 的折叠用例先暴露了这个漏洞（折叠后仍有 3 行 `*.test.ts Search / Read detail-l / Shell npx vitest` 展开）。
- `packages/app/src/hooks/use-settings/storage.ts`：`TimelineDetailLevel` 增加 `thinking`，存储枚举与档位顺序同步。
- `packages/app/src/i18n/resources/*.ts`：九种语言补 `settings.general.timelineDetail.options.thinking`。
- `packages/app/e2e/browser/timeline-detail-level.spec.ts`：新增「live 档下思考下方落了工具调用即折叠」；第一例扩成四档语义扫描；贴底跟随 / 上滚脱开的断言从 live 档移到 `thinking` 档——live 档的思考块在下一次工具调用落地时就折叠，窗口太短读不出跟随，改用元素句柄固定同一个滚动区。
- `packages/app/e2e/browser/agent-stream-ui.spec.ts`：`expanded` 档下工具行现在默认展开，原先「点击后应变展开」的断言改成「默认展开 → 点击折叠 → 再点开」。

## 怎么验证的

- typecheck / lint / format 全绿；storage、i18n resources、key-contract、locales 单测 128 例通过。
- e2e（Playwright，隔离 daemon + mock agent）：
  - `timeline-detail-level.spec.ts` 四例通过（档位语义扫描、live 只展开最新、live 遇工具调用折叠、thinking 档贴底跟随与上滚脱开）。
  - `agent-stream-ui.spec.ts` 的 `keeps stream controls above the composer` 通过（expanded 档下点开→折叠→再点开，以及全部折叠后所有行归位）。
  - 定位「全部折叠漏掉 nested 子行」时用过一次性探针 spec（逐行打印 badge 的 aria-expanded），定位后已删除，仓库无残留。

## 评审轮（设计审查 + 过度工程审查，均通过子代理执行）

结论均为有条件可合，按评审落地：

- **折叠台账跨档位残留**：「全部折叠」的台账原来跨档位有效，切档后新的档位默认值会被它静默否决。改为存 `{ level, ids }` 并按档位派生，切档即视为空（用 effect 清空会晚一帧，而行的 key 不含台账，那一帧的折叠会留在屏幕上）。
- **档位枚举双写**：`TIMELINE_DETAIL_LEVELS` 与 zod 的 `.enum([...])` 两处写同一串，漏改一处会静默吞掉已存档位。改为 `z.enum(TIMELINE_DETAIL_LEVELS)`，与同文件 `ThemePreferenceSchema` 同形。
- **档位语义收进 storage**：新增 `expandsThinking()` / `expandsToolDetail()`，两个渲染回调各留一个条件，不再在 view 里硬写档位判断。
- **`forceInline` 三处重复**：收敛为 `ToolCallSlot` 内 `rest.forceInline ?? rest.defaultExpanded` 一处兜底，调用点各删一行。
- **nested 子行 id 收集**：从 view 搬进 `tool-calls/detail-level/nested-codemode.ts` 的 `nestedGroupRowIds()`，渲染与折叠同源。
- **e2e**：原先要求「最新思考恰好展开」的断言在窄窗口上结构性 flaky，改为只在尾项是 thinking 时断言；新增设置面板用例（5 档可选、选择落到存储）与 `thinking` 档持久化单测。
  评审建议把 live 的两条断言并进同一用例省一次 agent 启动，试过一次后放弃：既有用例要 `mockReasoningRepeat: 12` 才能撑出贴底跟随需要的高度，而这么长的 reasoning 会把工具调用推到回合结束之外，「尾项变成工具行」采样不到（`tail-still-thinking`）。两条断言需要相反的 mock 参数，保留两个用例并在代码里注明原因。
- 评审确认不做的：按「思考展开 × 工具展开」两个正交维度重构档位（档位是单条序、存储是标量，收益只有省两个布尔）；把 `ToolCall` 的挂载期 `useState` 提成受控 prop（会改行组件的公共契约，超出本次范围）。

## 对 byissue/ 的影响

- 无 spec 更新：档位语义可从代码与 i18n 重建，072 已判定这类显示设置不进 project spec。
- 072 的四档语义表已被本次取代（`expanded` 与 `live` 都变了），历史 issue 不回改，以本条与 076 为准。
- 072 关闭时的遗留「live 档全部折叠后，下一个思考块仍会自动展开」行为不变，只是判定与抑制统一进 `collapsedDetailIds`。
