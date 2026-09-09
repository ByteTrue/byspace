---
kind: issue
title: "修复 .mise.toml 在 Windows 原生终端下 HOME 未定义及路径不兼容"
type: ff
status: closed
created: 2026-09-09
---

# 修复 .mise.toml 在 Windows 原生终端下 HOME 未定义及路径不兼容

修复 Windows 原生终端（PowerShell / CMD）下未定义 `HOME` 导致 mise 无法解析 `.mise.toml` 且中断报错的问题，同时适配 Windows 下 mise 默认将工具安装到 `AppData/Local/mise` 而非 `~/.local/share/mise` 的路径差异。

- 改动：`.mise.toml` — 使用 `get_env` 获取 `HOME` / `USERPROFILE` 与 `LOCALAPPDATA`，根据 `os()` 分支设置 `ANDROID_HOME` 与 `_.path`
- 验证：在移除 `HOME` 环境变量的 PowerShell 进程中执行 `mise env --json`，确认正常生成并输出合法的 Windows 路径
- codestable：无影响
