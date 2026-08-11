---
kind: issue
title: "迁移 CodeStable 产物目录"
type: ff
status: closed
created: 2026-08-11
---

# 迁移 CodeStable 产物目录

把旧 `.cs/` 工作区完整迁移到新版 `codestable/`：Epic 与所属 Issue 改为路径表达归属，日期目录改为独立编号树，重复编号与状态命名漂移已消除，正文和仓库文档中的引用同步更新。

- 改动：`codestable/` — 保留全部既有 Spec、Epic、Issue、Explore、Talk、Note 与证据，并补齐 `vision/`、`tools/` 基础目录。
- 改动：`docs/terminal-performance.md` — Direct Terminal 基线证据改指向新 Explore 路径。
- 改动：`scripts/check-branding.mjs` — 品牌检查忽略新的 CodeStable 工作区路径。
- 验证：检查目录命名、每棵树编号唯一、文件名与 frontmatter 状态一致、Issue 类型合法、无旧归属字段、无 `.cs/`/日期目录残留，以及本地 Markdown 链接和 `codestable/` 路径均可解析。
- codestable：本条记录迁移本身；Project Spec、Epic 活规格与历史正文内容不变。
