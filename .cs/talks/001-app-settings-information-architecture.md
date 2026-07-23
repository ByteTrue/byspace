# App 设置的信息架构

## 原始想法

App 分组下的 General、Appearance、Diagnostics、About 页面内容偏少，希望优化设置页组织。

## 真问题

当前设置页把页面内内容分组提升成了一级导航，导致 App 导航零碎；但全部合成一个页面又会损失成熟、稳定的查找入口。

## 已确认决策

- App 一级导航收敛为 Preferences、Projects、About。
- Preferences 聚合原 General、Appearance、Diagnostics 的全部内容，并继续使用页面内 section 分组。
- Projects 是可管理资源，保持独立入口。
- About 是约定俗成的低频目的地，保持独立入口。
- Diagnostics 现在不独立；日后内容确实增长时再拆出。
- 不增加设置搜索。
- 不为旧的 General、Appearance、Diagnostics URL 增加专门的兼容映射或跳转。

## 目标示意

```text
APP
  Preferences
    General
    Appearance
    Diagnostics
  Projects
  About

HOST
  Host
  Connections
  Agents
  Workspaces
  Providers
  Usage
```

## 影响与取舍

- 一级导航从五项收敛为三项，减少零碎入口。
- 保留 Projects 与 About 的稳定心智模型，不形成一个包揽所有内容的超长页面。
- Preferences 内部保持原有控件和 section，不改变设置行为或存储。

## 初步出口

按快改落地：调整设置路由、侧栏、聚合内容、国际化文案与相关测试；完成后留下 ff 记录。
