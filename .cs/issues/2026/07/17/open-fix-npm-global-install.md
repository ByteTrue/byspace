---
kind: issue
title: "修复 npm 全局安装缺少运行时依赖"
type: bug
status: open
created: 2026-07-17
epic: ".cs/epics/2026/07/14/web-only-byspace/spec.md"
---

# 修复 npm 全局安装缺少运行时依赖

## 目标

从 registry 或本地发布 tarball 执行 `npm install -g @bytetrue/byspace` 后，`byspace --version`、`byspace --help` 和隔离 daemon smoke 直接可用，不产生空的外部依赖目录。

## 范围

- 修复 `scripts/pack-byspace.mjs` 的单包依赖所有权。
- 让现有 package smoke 真正使用 npm 的 global install 形状。
- 保持一个公开 npm 包；不发布内部 workspace，不把外部依赖或构建机原生二进制打进 tarball。
- 不修改 daemon、Provider 或 Web 功能。

## 当前证据

- 预期：首次发布 issue 和 release 文档都承诺全局安装后 CLI/daemon 可运行。
- 实际：npm 12 全局安装 `0.1.0` 只增加 10 个包；`express`、`node-pty` 等目录为空，CLI 在导入 bundled server 时抛 `ERR_MODULE_NOT_FOUND`。
- 最小场景：干净 prefix 运行 `npm install -g --prefix <tmp> @bytetrue/byspace@0.1.0`，随后 `<tmp>/bin/byspace --version`。

## 质量目标

- **可靠性 / 易安装性**：Node 22 与受支持 npm 的干净 global prefix 安装后必须直接运行 CLI 和隔离 daemon；以三平台 CI distribution smoke 验证。
- **兼容性**：外部原生依赖仍由目标平台 npm 安装；tarball 只内嵌 5 个 BySpace workspace；以 tarball manifest、global dependency tree 和 daemon smoke 验证。
- **可维护性 / 可测试性**：release gate 必须复现真实 `npm install -g` 布局，不能再用 local-prefix install 代替。

## 反馈回路

```bash
npm run pack:byspace
npm install -g --prefix "$TMP/prefix" artifacts/bytetrue-byspace-0.1.0.tgz
"$TMP/prefix/bin/byspace" --version
npm ls -g --prefix "$TMP/prefix" @bytetrue/byspace express node-pty --all
```

修复前稳定复现空 `express` / `node-pty` 目录和 `ERR_MODULE_NOT_FOUND`；可重复、确定、无需外部 daemon。

## 复现与最小化

- local project install 同一 registry package 会安装 264 个包并正常运行。
- global install 只安装 10 个包并生成空目录。
- 最小 npm fixture 证明：只要 bundled package 自己声明了与 root 重叠的外部依赖，npm global install 就把外部依赖 dedupe 成空目录；删除 bundled package 的 dependency declarations 后，global install 正常安装它们。

## 根因定位

1. 发布包把 5 个内部 workspace 放在 `node_modules` 并列入 `bundleDependencies`。
2. root manifest 又汇总了这些 workspace 的外部依赖，目的是让目标平台安装原生依赖。
3. bundled workspace manifest 仍保留同一外部 dependency graph。
4. npm global install 不安装 bundled package 的传递依赖，却把这些重复声明 dedupe 到 root 位置，最终留下空目录并判为 invalid。
5. local install 的 Arborist 路径会安装这些依赖，所以原 smoke 使用 `npm install --prefix` 时漏掉了问题。

影响所有 `npm install -g` 用户，不影响 local dependency install。

## 执行记录

- `packWorkspace` 改用显式 `./packages/...` 路径，避免 npm 12 把无 `./` 的 workspace 路径解析成 GitHub shorthand。
- staging 时将所有外部 runtime 依赖汇总到公开 root manifest，并从内嵌 workspace manifest 删除 dependency declarations；内嵌 workspace 继续保留代码、exports 与版本元数据。
- package smoke 已改为真实 `npm install -g --prefix <empty-prefix>`，并在 CLI/daemon 检查前断言 `express`、`node-pty` 的 `package.json` 和平台 bin 存在。

- `npm run smoke:package`：Node 22/npm 10 全局安装、CLI version/help、隔离 daemon start/status/force-stop 通过。
- Node 24.15.0/npm 12.0.1 同一 smoke 通过，覆盖原始失败环境。
- 修复后的 tarball 仍只内嵌 5 个 BySpace workspace；56 个外部依赖由目标平台安装，tarball 中 `express` / `node-pty` 条目为 0。
- 内嵌 5 个 workspace manifest 均不再声明 dependencies / optionalDependencies / peerDependencies；干净 global prefix 中 `express@4.22.2` 与 `node-pty@1.2.0-beta.11` 实体完整，`npm ls -g` 无 invalid/missing。
- 待执行 typecheck、lint、format 和 CI 三平台 distribution gate。
- Playwright 回归同步修：Add Project 文案、loading testId + clock 防竞态、outdated daemon 版本 override。

## 关闭回写

- 更新 `docs/release.md`，明确 global-prefix smoke 和单一依赖所有权。
- 若修复发布成功，将稳定包装约束回写所属 Epic / project spec。

## 关闭结论

待验证与正式关闭。
