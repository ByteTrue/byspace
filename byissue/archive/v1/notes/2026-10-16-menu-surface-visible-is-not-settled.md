# 浮层表面的 e2e：等稳定，不等可见

`AnchoredSurface` 在拿到 anchor 测量之前把内容渲染在 `top: -9999`，入场又是一段 scale 关键帧
（0.97 → 1，150ms，`menu-overlay.tsx` 的 `contentEntering`）。Playwright 的 `toBeVisible()` 只看有没有
盒子，这两件事它都不敏感：`-9999` 有个盒子，缩放中的盒子也有。于是「点开菜单 → 立刻点某项 / 量某项」
会打在没有到达的表面或还没缩放到位的盒子上。

2026-10-16 改 BySpace 导航为悬浮菜单时踩到，一次跑出 4 个红：

- 点击被 `sidebar-nav-menu-backdrop` 拦下（目标还在视口外，backdrop 已经铺在上面）。
- 两个项的高度差 28.2746 vs 27.2996 —— 同一行、同一份样式，差的就是入场缩放。
- 项宽为零的中间帧。

判据写在 `packages/app/e2e/support/helpers/sidebar-chrome.ts` 的 `expectNavMenuSettled`：轮询
`[data-menu-item="true"]` 的第一项，要求 (1) 盒子在视口内、(2) 与上一次取样完全一致（停止移动）。
探针用「本菜单里任意一项」而不是某个具体 testID，这样用户重排/隐藏条目也不会把它变成恒真断言
（issue 060 就吃过一次恒真 helper）。

通用写法：**浮层表面的打开动作等"稳定"，不等"可见"**。`toBeVisible` 够用于静态布局，不够用于锚定
加动画的表面。
