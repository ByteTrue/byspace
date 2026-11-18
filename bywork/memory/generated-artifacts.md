# 生成物与批量改名的纪律

## 结论

- 生成文件只在它是外部契约时才提交进仓库；提交的生成文件必须配漂移测试（生成器重跑比对）。
- 产物两个根：`.dev/` 装本地可再生的一切，`dist/` 只装对外发布物；`build/` 只放 git 跟踪的打包模板，构建不许往里写。四个例外由消费方钉死：`internal/webui/dist`（go:embed）、`packages/*/dist`（npm exports）、`web/dist`（wrangler assets）、`build/android/app/{build,src/main/jniLibs}`（gradle）。布局写在 `docs/development.md#build-outputs`。
- 过程证据靠配置改落点，不靠事后删：playwright `outputDir`、vitest `attachmentsDir`/`screenshotDirectory` 都指向 `.dev/`。vitest 的显式 `page.screenshot({path})` 仍按测试文件目录解析（`@vitest/browser` 的 `resolveScreenshotPath` 对 customPath 走 `resolve(dirname(testPath), customPath)`），配置管不到，写截图别传相对 path。
- `rm -rf .dev` 现在会连 dev daemon 状态一起删；`make clean` 只删 `.dev/{bin,build,test-results,vitest}` 与 `dist/`，不碰 `.dev/byspace-home`。
- 批量 URL/symlink 改名前先确认改名目标存在；改名脚本本身要在真实目标上验证。
- 本地打 npm tarball 要用仓库 pin 的 `npm@10.9.9`（package.json 的 packageManager）。npm 12 的 `npm pack --json` 返回按包名索引的对象，npm 10 返回数组；`scripts/package-go-release.mjs:215` 按数组解构，用新 npm 跑会报 `TypeError: object is not iterable`。那不是脚本缺陷。该入口还要求 `git status --porcelain` 为空。
- tarball 内部的 `bin/byspace` + `vendor/<platform>` 是对外契约，与仓库根有没有 `bin/` 无关（仓库的 `bin/` 已收进 `.dev/bin/`）。
- 在生成 JS 的模板字符串里，要输出字面 backslash-n 必须写 "\\n"；代码里的 String.fromCharCode(10) 可能是刻意躲这层转义，「简化」它会破坏生成文件（症状在 pi e2e 表现为 `Test timed out in 240000ms`）。现存实例：web/src/components/markdown/fence/mermaid/source-policy.ts:25,28 与 runtime/html.gen.ts。

## 依据

- 类型：可重跑证明（漂移与转义事故均实际发生）。
- 被否决的相关方案：生成物一律提交或一律不提交（判据是外部契约）；把 fromCharCode 当冗余简化。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/002-generated-artifacts-and-remote-urls.md`、`009-generated-source-escaping-in-template-literals.md`；mermaid 生成器 `web/src/components/markdown/fence/mermaid/build-runtime.mjs`。
- 适用条件：提交生成物、写批量改名脚本、改生成器模板、新增会写文件的构建/测试入口时。009 的原始事故点已随 mermaid 重写变化，规则本身仍适用。产物布局那三条来自 2026-11-18 的收拢（`bywork/work/artifact-layout/`），每条都有真实入口跑过：make build/dmg/build-android/release-cli/clean、dev daemon/desktop、失败探针看证据落点。

## 重访条件

- 生成器改为非模板字符串方案（转义层消失）。
- 出现误删 dev home 的事故，或 `.dev/` 里产物与状态混放导致清理不敢下手：把产物根换成独立的 `.build/`。
