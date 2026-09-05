---
kind: issue
title: "ff: Android APK 发布 CI 化（android-apk-release.yml）"
type: ff
status: closed
created: 2026-09-05
---

# Android APK 发布 CI 化

## 做了什么

Android APK 从本地手工构建（约 40 分钟人工操作）迁入 GitHub Actions，成为发布七件套中最后一个 CI 化的产物。决策路径：上游 paseo 用 EAS 云构建，但 EAS 免费档 Android ~15 次/月不够我们的迭代节奏；仓库是 public（Actions 免费无限量）、签名 keystore secrets 早在 2026-08-26 已配置、本地 gradle 链已经四次发布验证——GH runner 路线零新增依赖。当年 EAS 构建失败的根因也一并查明：fork 时剥掉了 `app.config.js` 的 `extra.eas.projectId` + `owner`（EAS 项目是账号私有的，不能复用上游的），无项目归属必败，与代码无关。

## 改了哪些

- 新增 `.github/workflows/android-apk-release.yml`：结构照抄上游（`v*`/`android-v*` tag 触发 + workflow_dispatch 重跑 + ensure-release 幂等），构建链换成本地验证过的 gradle 命令（`build:app-deps` → `expo prebuild` → `assembleRelease -x lint 系列 --no-daemon --max-workers=2 -Dorg.gradle.parallel=false`），apksigner 用 `ANDROID_RELEASE_KEYSTORE_BASE64` 等 4 个 secrets 签名，断言 application-id/versionName/ABI 后上传 `BySpace-<version>-android.apk(.sha256)`。去掉了上游的 `@boudra` 私有 npm registry（我们全是 workspace 包，不需要）。
- 新增 `scripts/github-release.mjs`：从上游机械导入，品牌替换 `Paseo ${tag}` → `BySpace ${tag}`（draft release 名）。
- `docs/release.md` / `docs/android.md`：Android 段改为 CI 为主、本地为兜底；`android-v*` 重构建通道写入文档。

## 怎样验证

- 本地：actionlint PASS、ci-workflow 契约测试 9/9、`emit-release-env.mjs --source-tag android-v0.11.3` 归一化正确、`github-release.mjs --tag v0.11.3` 幂等命中现有 release。
- 端到端（android-v0.11.3 tag 实战，四轮）：① runner 被 GitHub 驱逐（非代码问题，rerun）；② aapt2 versionName 提取 sed 假设字段顺序错误（改为不依赖顺序的 grep，本地真 APK 验证）；③ 全链绿但产物对账发现 **CI secrets 里存的是 2026-08-26 旧 keystore，本地 8/29 已换 v2 后无人同步**——CI 签出的 cert 与四次本地发布不同，装不上已装设备。用当前权威 keystore 刷新全部 4 个 secrets 后 workflow_dispatch 重跑，最终产物 cert 与本地构建完全一致（`aaf8e0ed...`）。
- 教训：手工发布流程的隐性依赖（本地换了签名钥但 secrets 未同步）只有产物对账能拦截；workflow 的 verify 步骤因此值得保留 cert 断言。

## 对 codestable/ 的影响

- issue 010（CI/CD 治理）的 CD 部分「Android 手工」缺口关闭；发布链七件套（npm/Web/Docker/Desktop/iOS/Android/Nix 校验）全部 CI 化。
- 历史裁决 #1704（本地构建优于云构建）按精神保持：exact-SHA 构建，只是构建机从本机换成 GH runner（同 4C/16G 规格）。
