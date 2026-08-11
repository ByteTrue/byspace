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

1. CI 的 release artifact job 执行唯一一次 Web export，在同一 job 中将该 dist 嵌入 npm tarball，并分别上传 Web/npm artifact 及源 SHA/digest。App typecheck 与 unit tests 继续作为并行的完整 CI 门禁。
2. Deploy App 根据 release SHA 下载该 Web artifact，只执行 tag/npm preflight、必要的部署工具安装和 Cloudflare Pages 上传。
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
- 关闭判断：三平台与发布消费同一 npm artifact，CI release artifact job 与 Pages 使用同一 Web artifact，真实渠道证明完整。
- 遗留：Playwright 关键路径由 Issue 003 处理；Relay 自身没有证据支持继续优化。

## Implementation

- `package-artifact` starts independently of `app-tests`, performs the only Web export through the default `pack:byspace` path, embeds that exact dist in the daemon package, then emits separate Web/npm artifacts with exact commit/version/SHA-256 manifests.
- App typecheck and unit tests remain independent required jobs; artifact creation before those gates finish grants no release authority because publishers select only an overall-successful exact-SHA CI run.
- Linux, macOS, and Windows download, verify, globally install, and smoke the one npm tarball without repacking; distribution jobs restore the npm cache but never consume repository `node_modules`.
- `Publish npm` selects a successful push-event CI run by exact SHA, downloads and verifies its tarball, publishes it with the existing Trusted Publishing boundary, then downloads the registry tarball and verifies the same digest. Already-published reruns follow the same registry digest proof.
- `Deploy App` selects the same successful exact-SHA CI run, downloads and verifies its Web artifact, installs Wrangler from the committed lockfile, and deploys without rebuilding.
- Artifact absence, wrong commit/run selection, version mismatch, digest mismatch, and semantic archive mismatch fail closed. Artifacts are retained for 14 days; an expired artifact requires rerunning exact-SHA CI before release.

## Evidence status

- Local manifest unit tests, workflow contract tests, full package build/smoke, YAML parsing, typecheck, lint, format, whitespace checks, and independent implementation review passed before the first workflow push.
- exact-SHA `d78c0b9e9` 的 CI run `31484477142` 已生成并回读 Web artifact（SHA-256 `2fe6d34d…b5b4`）和 npm artifact（SHA-256 `9fa3443b…3f08`）；npm 内嵌的 37 个未压缩 Web 文件与 canonical Web artifact 逐字节一致。
- 同一 npm tarball 的 manifest 校验与全局安装 smoke 在 Ubuntu、macOS、Windows 均通过；app artifact job 4:41，package artifact job 2:08，Linux/macOS distribution 各约 45 秒，Windows 3:22。
- 该 workflow 因独立的 Windows shortstat 后台测试竞态而总体失败，因此 npm/App publisher 不会选择它；这同时验证了“只接受 successful exact-SHA push CI”的失败关闭边界。
- exact-SHA `c2e5aa66f` 的首次执行中，同一 tarball 在 Linux/macOS 通过，Windows 在全局安装后遇到一次 daemon readiness 超时；只重跑失败 job 时同一 digest 的 Windows smoke 在 4:31 内通过，run 最终 success。脚本现会在超时时输出 bounded status/daemon log，Windows job 同时恢复 npm cache；没有放宽 20 秒 readiness 门禁。
- 该 run 还证明 `app-tests`（5:03）→ `package-artifact`（2:12）串行后再启动 Windows install 会制造新的关键路径，因此 artifact ownership 已反转为独立 `package-artifact` 一次构建 Web/npm，App tests 保持并行门禁。
- exact-SHA `348efeae0` 的 run `31489371511` 验证了新 ownership：独立 `package-artifact` 从 workflow 起点并行，4:04 生成 npm SHA-256 `9fa3443b…3f08` 与 Web SHA-256 `fd6f0fb5…03123`；Ubuntu、macOS、Windows 对同一 npm artifact 的校验、安装和 smoke 分别约 1:05、0:41、3:17，全部通过。
- 从该 run 下载两份 artifact 后，manifest 对 commit/version/digest 的本地回验通过；解包 npm 并排除服务器额外生成的 `.gz`/`.br` 预压缩副本后，内嵌 Web 与 promoted Web `dist` 逐文件一致。
- 该 workflow 最终由独立的 Ubuntu server-test stdin `EPIPE` 阻断（Issue 004），所以 publisher 仍正确拒绝选择它。新 ownership 的 artifact 和三平台 distribution 已验证；真实 cross-workflow promotion、npm registry digest round-trip、Pages、Beta/Stable tuple 与 CI-green 后部署耗时仍待完整绿色 run 和真实渠道发布。
- exact-SHA `8a4e04ac5` 的 run `31493797852` 进一步证明失败不在 artifact 或 daemon：Windows 已验证相同 tarball digest，daemon 在约 1.7 秒内完成启动并挂载 Web UI，但 smoke 使用的完整 `daemon status` 会先执行 Windows PID→Node 路径诊断，子进程多次超时后才连接已就绪 daemon。readiness 已改为 20 秒内直接探测打包 daemon 的 Web UI 根路径并校验注入 marker，再从 `byspace.pid` 与持久配置验证 listen/relay/defaults；保留 fail-closed 门禁和 daemon-log 诊断，不再把运维诊断命令当健康检查。
