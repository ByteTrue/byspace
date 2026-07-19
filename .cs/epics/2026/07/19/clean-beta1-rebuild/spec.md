---
kind: epic
title: "以 Paseo 0.2.0-beta.1 干净重建 BySpace"
status: active
created: 2026-07-19
---

# 以 Paseo 0.2.0-beta.1 干净重建 BySpace

## 目标

只完成五件事：以精确 beta.1 source tree 为基础；删除不支持的客户端和 Browser automation；完整改名 BySpace；发布到 ByteTrue npm/Cloudflare；用无父提交的默认分支清除上游 contributors 展示。

## 当前方案

1. Root commit 的 tree 与 upstream `0bec06c2db7d3ee071416cde80229eabd682b03e` 完全相同，但没有 parent；commit message 记录 source URL、SHA、tree 和 AGPL。
2. 第二笔 commit 删除 Electron、native iOS/Android、`expo-two-way-audio`、website 和 Browser automation，保留 Web/PWA、CLI、daemon、relay。
3. 后续身份 commits 只做 `BySpace`、`byspace`、`BYSPACE_*`、`@bytetrue/byspace*`、`~/.byspace` 与相关文件/符号迁移。
4. Release commit 使用一个经过 global-install smoke 的 `@bytetrue/byspace` tarball，并从 exact-SHA CI 部署 Pages/Relay。
5. 最终切换前建立离线 Git bundle；切换后删除远端旧 ancestry branches/tags/releases，等待 GitHub Contributors cache 刷新。

## 明确不做

- 不移植 beta.1 之后的 upstream commits。
- 不引入 Paseo Hub。
- 不加入 Pi `max` thinking；当前保持 upstream beta.1 的 `xhigh` 上限。
- 不迁移旧 `~/.byspace` 状态；切换时另行备份并使用 fresh home。
- 不在最终确认前推送、发布、部署或停止当前 daemon。

## 质量约束

- Root tree 必须与 upstream beta.1 tree byte-identical。
- 最终默认分支只包含 ByteTrue author identity，且 LICENSE/README 保留上游归属。
- Web/server/typecheck/lint/format、focused tests、三平台 npm global-install smoke、Pages/Relay dry-run 必须通过。
- npm、Cloudflare、GitHub main 和本机 daemon 每个危险步骤都必须可独立停止和回滚。

## 关闭条件

用户确认生产切换完成；clean `main`、npm beta、Pages、Relay、本机 daemon 和 Contributors graph/refs 均完成验证，然后将稳定事实回写 `.cs/spec/index.md` 并关闭 Epic。
