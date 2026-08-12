---
kind: issue
title: "修复 Pi 终端状态与 Archive 下拉图标"
type: ff
status: closed
created: 2026-08-11
---

# 修复 Pi 终端状态与 Archive 下拉图标

Pi 终端活动上报现在只保留一个进行中的请求和一个最新待发送状态，避免较早的 `running` 请求覆盖后续 `idle`；Archive Workspace 分裂按钮的下拉按钮现在填满容器高度。

- 改动：`packages/server/src/terminal/agent-hooks/pi/pi-extension.ts`、`pi.test.ts` — 串行且有界地上报生命周期状态，并覆盖并发、合并与失败续传。
- 改动：`packages/app/src/git/actions-split-button.tsx`、`worktree-archive.spec.ts` — 修正菜单 Trigger 外层拉伸、内部真实按钮仍按图标内容收缩导致的半高布局，并锁定主按钮与下拉按钮的几何边界。
- 文档：`docs/terminal-activity.md` — 记录 Pi 状态上报的顺序与有界合并不变量。
- 验证：Pi 定向测试、Archive 浏览器几何回归、全仓 typecheck、lint、目标文件格式化、Server build 与 Web export。
- codestable：无规格影响；恢复既有状态与视觉行为。
