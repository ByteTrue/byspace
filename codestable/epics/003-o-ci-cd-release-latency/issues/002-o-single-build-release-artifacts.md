---
kind: issue
title: "统一构建、验证和晋升发布产物"
type: refactor
status: open
created: 2026-08-11
---

# 统一构建、验证和晋升发布产物

## 做成以后是什么样

一次 release commit 只生成一份 npm tarball 和一份 Web dist。CI 验证这两份 artifact，npm Publisher 与 App Deploy 再原样晋升它们；发布后的内容不再来自第二次构建。

**范围：** npm package build、三平台 smoke、Publisher、App CI artifact、Pages deploy，以及支撑 exact-SHA/digest 验证的最小脚本。**不包含：** Playwright shard、Relay 部署实现、发布时机、版本策略、渠道语义或降低完整 CI 门禁。

## 当前结构问题

- CI 的 distribution matrix 在 Linux、macOS、Windows 各自重新 pack 并 smoke；Ubuntu artifact 虽被上传，Publisher 仍执行约 5 分钟的 `release:check`，重新构建、安装并 smoke 另一份 tarball。
- App CI 已执行 typecheck、unit tests 与 Web export；Deploy App 又重新安装依赖、typecheck 和 export，约再花 3 分钟。
- 因而“CI 验证的构建”和“最终部署的构建”只靠同一源码推定等价，不是同一字节产物。

## 目标流水

### npm package

1. CI 的 package build job 执行 package 结构测试、release verification 与唯一一次 pack，上传 tarball、版本、源 SHA 和 SHA-256。
2. Linux、macOS、Windows smoke job 下载该 tarball，以现有真实全局安装、native load、CLI、hosted defaults 与 daemon startup 检查验证同一 artifact；smoke 脚本增加最小的“使用现有 artifact”入口，不再隐式 pack。
3. 完整 CI 全绿后，Publisher 根据 release tag 的 exact SHA 找到成功 CI run，下载并校验 artifact。
4. Publisher 使用 npm Trusted Publishing 发布该 tarball，再验证唯一版本与 dist-tag；不再运行完整源码构建。

当前 `release:check` 中 CI 尚未覆盖但仍有价值的 `test:pack`、`release:verify` 等检查必须迁入 package build job，不能因删除 Publisher 重复步骤而消失。

### Web

1. App CI job 在 typecheck、unit tests 与 Web export 成功后上传 `packages/app/dist`，并记录源 SHA/digest。
2. Deploy App 根据 release SHA 下载该 artifact，只执行 tag/npm preflight、必要的部署工具安装和 Cloudflare Pages 上传。
3. 部署阶段不得重新 export；artifact 缺失或身份不符时失败。

Relay 保持现有同 SHA 部署与 post-deploy verification；它当前约 30 秒，不进入本 Issue 的构建复用。

## 失败关闭与安全边界

- 只接受同仓库、预期 workflow、成功 conclusion、head SHA 等于 release SHA 的 run artifact。
- artifact 名称不能只靠可碰撞的“latest”；必须由已验证 run ID 获取。
- tag/version、package manifest、tarball metadata、digest 任一不符都停止发布。
- artifact 缺失或过期时不在 Publisher/Deploy 中 fallback 重建；应重新运行 exact-SHA CI 生成受验证 artifact。
- npm OIDC 与 Cloudflare secrets 只出现在受信任的 tag/default-branch 发布上下文；PR artifact 不能触达发布权限。
- Beta/Stable 的 npm dist-tag、Pages project、Relay worker 与后置“不变量渠道未变化”检查保持原样。

## 验证

- package/release 脚本单测覆盖使用现有 artifact、版本/digest 不匹配、缺失 artifact 与错误 run identity。
- 三平台 smoke 输出同一个 tarball SHA-256，且现有全局安装与 daemon smoke 全部通过。
- Publisher 日志证明 npm 实际发布文件的 digest 与 CI artifact 相同。
- App Deploy 日志证明 Pages 输入 artifact 的 run ID、SHA 与 digest 等于 App CI 输出。
- workflow 语法、typecheck、lint、format、branding、package tests、dry-run 与现有 release hardening checks 通过。
- 用一次真实 Beta 验证 npm/Web/Relay tuple 和 Stable 未变化；下一次真实 Stable 再验证 Stable tuple 和 Beta 未变化，不为验收额外制造 Stable 版本。
- 记录 CI 绿后各部署 workflow 的 runner 执行时间，目标合计不高于 2 分钟；外部 queue time 分开报告。

## 关闭时

- 回写候选：Epic spec 固化最终 artifact 身份链、耗时结果和实际 retention。
- 关闭判断：三平台与发布消费同一 npm artifact，App CI 与 Pages 使用同一 Web artifact，真实渠道证明完整。
- 遗留：Playwright 关键路径由 Issue 003 处理；Relay 自身没有证据支持继续优化。

## Implementation

- `app-tests` performs the only Web export, archives `packages/app/dist`, and emits an exact commit/version/SHA-256 manifest.
- `package-artifact` waits for that Web artifact, verifies and extracts it, then calls `pack:byspace -- --skip-web-export` so the daemon embeds the same distribution rather than exporting again.
- The package job creates one npm tarball and manifest; Linux, macOS, and Windows download, verify, globally install, and smoke that same tarball without repacking.
- `Publish npm` selects a successful push-event CI run by exact SHA, downloads and verifies its tarball, publishes it with the existing Trusted Publishing boundary, then downloads the registry tarball and verifies the same digest. Already-published reruns follow the same registry digest proof.
- `Deploy App` selects the same successful exact-SHA CI run, downloads and verifies its Web artifact, installs Wrangler from the committed lockfile, and deploys without rebuilding.
- Artifact absence, wrong commit/run selection, version mismatch, digest mismatch, and semantic archive mismatch fail closed. Artifacts are retained for 14 days; an expired artifact requires rerunning exact-SHA CI before release.

## Evidence status

- Local manifest unit tests, workflow contract tests, full package build/smoke, YAML parsing, typecheck, lint, format, and whitespace checks are required before the first workflow push.
- Linux/macOS/Windows reuse, real cross-workflow download, actual npm registry digest continuity, Pages promotion, and timing remain pending exact-SHA CI and a real channel release.
