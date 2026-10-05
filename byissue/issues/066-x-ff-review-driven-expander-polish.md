---
kind: issue
title: 评审驱动的展开块样式清理
type: ff
status: closed
created: 2026-10-10
---

# 评审驱动的展开块样式清理

## 做了什么

PR #17（065）开审后并行跑了 code review 与 ponytail review 两个子代理评审，用户批准全做三项修复：① 删掉 065 改动留下的死代码（净 -42 行）；② 高亮成功路径的代码颜色与降级路径统一；③ compact sheet 上恢复内容块分界。

## 改了哪些

packages/app/src/components/message.tsx：删空样式 pressableExpanded/detailWrapperBorderless；删 borderlessWhenExpanded 整条 no-op prop 链（声明、默认值、比较器、唯一调用点）；detailWrapperStyle memo 塌缩为直接引用。

packages/app/src/tool-calls/detail-level/overview/view.tsx：ExpandableBadge 用法删 borderlessWhenExpanded。

packages/app/src/components/tool-call-details.tsx：删 fullBleedBlock（与 diffContainer 等价）、scrollArea/jsonScroll/jsonScrollError 空样式及其别名与 DetailStyles 字段；ErrorSection 清未用参数。

packages/app/src/components/highlighted-content.tsx：lineText foreground → foregroundMuted（与 tool-call-details 的 scrollText 一致，高亮成功/降级两路径不再一亮一暗）。

packages/app/src/components/tool-call-sheet.tsx：content 背景 surface2 → surface1（detail 块扁平化后 sheet 需要页面色承载内容）。

## 怎么验证的

npm run typecheck 全绿；lint 5 个改动文件 0 warnings 0 errors；grep 无残留引用。CI run 37140502747 全绿（typecheck/lint/format/app-tests/server-tests/build/playwright 8 shards）。

## 对 byissue/ 的影响

- 排查"子代理超时后通知为何迟到"时发现的三条可复用知识落 notes/007（timer 迟到 bug、通知积压门控、扩展版本错位）。
