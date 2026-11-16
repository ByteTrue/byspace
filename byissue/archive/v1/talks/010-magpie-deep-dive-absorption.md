---
kind: talk
title: "全景扫描 Magpie (v0.1.2030)：吸收八项桌面与系统级工程精华"
created: 2026-10-29
---

# 全景扫描 Magpie (v0.1.2030)：吸收八项桌面与系统级工程精华

## 背景

在完成 Wails v3 桌面端/Android 客户端同构延伸、二进制直发与 CI 静态直出提速后，我们将本地参考仓库 `~/workspace/refs/magpie` 更新至最新（`v0.1.2030`），对其全部 77 个 `internal/` 子包与 `LESSONS.md` 进行了全景扫描，筛选出与 BySpace（本地 AI 编程工作台）高度契合的 8 项核心能力。

## 确认的 3 项决策

1. **范围（Q1 = A）**：8 个模块全部纳入（智能防休眠 `awake`、开机自启 `autostart`、macOS Dock 显隐控制、外部/旧版 Daemon 一键接管与端口诊断、Windows `.com` 终端伴侣与 WebView2 检测、Linux Wayland/无 GPU 渲染保护、macOS 菜单栏 Template 透明图标、核心配置自动滚动备份 `backup`），按 4 个纵向切片依次落地。
2. **智能防休眠档位与默认值（Q2 = A）**：对齐 Magpie，支持 `off`（关闭）/ `system`（防止系统休眠，屏幕可正常熄灭）/ `display`（防止系统与屏幕休眠）三档，**默认启用 `system`**（当有 Agent 正在运行或运行结束未满 10 分钟宽限期时阻止系统自动休眠，空闲满 10 分钟后自动释放）。
3. **macOS 菜单栏托盘图标（Q3 = A）**：采用 macOS 原生透明底单色 Template 矢量图标（`setTemplate:YES`），随浅色/深色菜单栏自动反转颜色。

## 落地路径

见 [Epic: 吸收 Magpie 八项桌面与系统级工程精华](../epics/2026-10-29-x-magpie-gems-absorption/spec.md)。
