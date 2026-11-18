---
kind: work
status: complete
current_unit: "全部完成"
next_action: "无。推分支后看 GitHub Actions 的真实结果"
must_hold: "只收拢产物与过程垃圾，不动源码目录布局；dist/ 保持对外发布契约；不留旧路径兼容 shim；不重启 6777 生产 daemon；不改既有测试断言"
proof_gap: ""
---

# 产物目录收拢到 .dev/ 与 dist/

## 目标与边界

用户要求（m00033）：「来整理一下我们仓库目录结构，总感觉变臃肿杂乱了，比如你看这 dist，bin，两个产物目录就很奇怪，还有各种散乱的产物目录」。

上一轮（m00001–m00032）已经删掉约 2.1G 可再生产物，仓库 3.4G→1.3G。这一轮解决的是产物为什么会长在这些位置，不是再删一次。

五轮澄清的取舍，用户回复（m00058）：「都按建议做」，即全部采纳下列推荐：

1. 范围只收拢产物与过程垃圾（bin/dist 中间物、截图、测试输出、根目录散落二进制）。源码目录（`assets/`、`design/`、`public-docs/`、`third_party/`、`workers/`）这轮不动，理由是改名牵动 import 路径、CI、文档和在跑的 work。
2. 两个语义互斥的根。`.dev/` 装本地可再生的一切，`dist/` 只装对外发布物。`bin/` 并进 `.dev/bin/`，`dist/` 里的中间 bundle 移走，`build/` 回到纯打包模板。
3. 过程证据改配置统一落到 `.dev/` 下，而不是保留各工具默认值再维护一张垃圾清单。`internal/webui/dist`（go:embed）和 `packages/*/dist`（tsc 声明）不动。
4. 一次性全改，不留 symlink 或 fallback。依据 AGENTS.md「app 和 daemon 一起发，不做兼容层」。代价是开发者手敲的 `./bin/byspace` 要改口。
5. 先落 work 检查点再逐行推进，因为改动横跨 Makefile / scripts / CI / docs，属于 AGENTS.md 要求主会话执行的大批量改动。

## 已定方案与约束

目标布局：

| 根 | 装什么 | 谁写 |
|---|---|---|
| `.dev/bin/` | 开发二进制 byspace / byspace-app、Android APK 中间物、self-update 暂存 | make build / build-app / build-android |
| `.dev/` 其余子目录 | 中间 bundle、iconset、dmg 暂存、截图、测试输出 | make app/dmg、vitest、playwright |
| `dist/` | zip、dmg、exe、apk、各平台 CLI、SHA256SUMS、npm tarball | make app/dmg/release-*、release:pack:bytetrue |
| `build/` | 只有 git 跟踪的打包模板 | 人 |
| `internal/webui/dist`、`packages/*/dist` | 不动（go:embed 与跨包声明契约） | build-web、tsc |

不能自由移动的契约（待子代理清单确认后逐项落 scope）：go:embed 指令、npm publish tarball 路径、GitHub release 资产上传 glob、gradle/Wails 要求的布局、wrangler 状态目录。

已知代价与重访信号：`.dev/` 目前是 gitignore 的本地状态根，产物并进来后 `rm -rf .dev` 会同时清掉 dev daemon 状态。若出现误删 dev home 的事故，就把产物根换成独立的 `.build/`。

相邻发现（本轮不做）：`bywork/work/project-npm/` 仍 in_progress，卡在 v0.26.4 发布验收余项，与本轮无依赖。

## 行为证明

| 行为路径 | 真实入口 | 操作 | 应观察到 | 证据 | 结果 |
|---|---|---|---|---|---|
| 开发构建产出到新位置 | `make build` | 在干净 checkout 跑构建 | 二进制出现在 `.dev/bin/byspace`，根目录无 `bin/` | `env -u GOROOT make build` exit=0，输出 `-o .dev/bin/byspace`；`ls .dev/bin/` 只有 byspace 31600178 字节；`rm -rf bin` 后根目录无 bin/；日志 `.dev/baseline/after-make-build.log` | 通过 |
| dev daemon 起得来 | `npm run dev:daemon` | 启动开发守护进程 | 监听 127.0.0.1:6778，home 指向 `.dev/byspace-home`，日志里的 Binary 是新路径 | `BYSPACE_SKIP_DEV_SERVER_BUILD=1 npm run dev:daemon` 打印 `Binary: /Users/zijie/workspace/byspace/.dev/bin/byspace`、`Listen: 127.0.0.1:6778`、`● byspace daemon (0.26.4) listening on 127.0.0.1:6778`；`npm run cli -- daemon stop` 返回 `stopped pid=15629`，再查 status 为 stopped。日志 `.dev/baseline/after-dev-daemon.log` | 通过 |
| CLI 仍可用 | `npm run cli -- daemon status` | 查询 dev daemon 状态 | 返回 dev home 的状态，不报缺二进制 | 改前 `.dev/baseline/cli-status.log` 与改后 `.dev/baseline/after-cli-status.log` 逐字相同：`stopped  home=/Users/zijie/workspace/byspace/.dev/byspace-home  serverId=srv_StogP7vptNiA`，exit=0 | 通过 |
| macOS 分发物落在 dist | `make dmg` | 打 app 与 dmg | `dist/` 只有 zip 与 dmg，中间 bundle 与 iconset 不在 `dist/` 也不在 `build/` | `env -u GOROOT make dmg` exit=0（日志 `.dev/baseline/after-make-dmg.log`）；`ls dist/` 只有 byspace-darwin-arm64.zip 12.7M 与 .dmg 13.5M；`.dev/build/` 只有 BySpace.app；`build/darwin/` 只剩 Info.plist，`git status build/` 只有 build.sh 的改动 | 通过 |
| Android APK 不再产出两份 | `make build-android` | 打侧载 APK | 中间物在 gradle 自己的布局里，`dist/byspace-android-arm64.apk` 一份，根目录无 `bin/` | `env -u GOROOT -u ANDROID_SDK_ROOT make build-android` exit=0，`BUILD SUCCESSFUL in 13s`，`● Built Android APK: .../dist/byspace-android-arm64.apk ( 29M)`（日志 `.dev/baseline/after-make-android.log`）；`find . -name '*.apk'`（排除 node_modules 与 dev home）只有 gradle 的 `build/android/app/build/outputs/apk/release/app-release.apk` 与 `dist/byspace-android-arm64.apk` | 通过 |
| 全平台 CLI 与 checksums | `make release-cli && make checksums` | 交叉编译并校验 | `dist/byspace-cli-*` 齐全，SHA256SUMS 覆盖它们 | exit=0（日志 `.dev/baseline/after-release-cli.log`），7 个平台全部编译；`dist/` 只有 7 个 CLI + apk + zip + dmg + SHA256SUMS；`cd dist && shasum -a 256 -c SHA256SUMS` 10 项全 OK | 通过 |
| npm 打包路径不变 | `npm run release:pack:bytetrue` | 打 npm tarball 并解开自检 | `dist/npm/bytetrue-byspace-<version>.tgz` 生成，内部仍是 `bin/byspace` + `vendor/<platform>` | 提交后（7c97386ac，工作区干净）实跑 exit=0：`dist/npm/bytetrue-byspace-0.26.4.tgz` 71M，sha256 4492f2d4…，五平台二进制齐全（darwin-arm64 31583666 / darwin-x64 32433200 / linux-arm64 31129760 / linux-x64 32153760 / windows-x64.exe 33887232）。`tar -tzf` 确认 `package/bin/byspace` 与 `package/vendor/*` 未变——仓库删掉的 `bin/` 与 tarball 内部的 `bin/` 是两回事。日志 `.dev/npm-pack2.log`。**环境坑**：本机 npm 12.2.2 的 `npm pack --json` 返回按包名索引的对象，脚本按 npm 10 的数组解构，直接跑报 `TypeError: object is not iterable`（`.dev/npm-pack.log`）。仓库 `packageManager: npm@10.9.9`，用该版本跑即通过——不是脚本缺陷，不改脚本 | 通过 |
| 开发桌面 bundle 落在 .dev | `node ./scripts/dev-desktop.mjs`（`byspace.json:16` 的 desktop 服务） | 启动开发版桌面窗口 | bundle 在 `.dev/build/BySpace Dev.app`，daemon 仍是 6778 + dev home，`dist/` 不新增文件 | `BYSPACE_SKIP_DEV_DESKTOP_BUILD=1 node ./scripts/dev-desktop.mjs` 打印 `Binary: .../.dev/build/BySpace Dev.app/Contents/MacOS/byspace-app`、`Daemon: 127.0.0.1:6778`、`Home: .../.dev/byspace-home`，窗口起来并 restored 5 terminal tabs；`npm run cli -- daemon status` 为 `running addr=127.0.0.1:6778`，kill 该进程后回到 stopped；期间 `dist/` 不存在。日志 `.dev/baseline/after-dev-desktop.log` | 通过 |
| 过程证据落在 .dev | playwright（`web/playwright.config.ts`）与 vitest browser（`web/vitest.config.ts`） | 跑一个必然失败、会写截图的 spec | 失败截图/trace/附件落在 `.dev/` 下，`web/test-results`、`web/.vitest-screenshots`、`web/.vitest-attachments` 不出现 | playwright：临时探针 `web/e2e/browser/zz-artifact-layout-probe.spec.ts`（已删）失败后 `.dev/test-results/zz-.../{test-failed-1.png,trace.zip,probe.png,error-context.md}` 齐全，`web/test-results` 不存在；先用 `--output=./.tmp-artifact-layout-evidence` 跑同一探针，四类文件落在那里，证明落点由 outputDir 决定。日志 `.dev/baseline/{after,failure}-playwright.log`。vitest：临时探针 `web/src/core/lib/zz-artifact-layout-probe.browser.test.tsx`（已删）失败后截图在 `.dev/vitest/screenshots/src/core/lib/...`、附件在 `.dev/vitest/attachments/345eea...png`，`web/.vitest-*` 不存在，日志 `.dev/baseline/after-vitest-browser.log` | 通过 |
| 清理入口覆盖全部产物 | `make clean` | 执行清理 | 产物清空，`internal/webui/dist/.keep` 保留，dev home 与 node_modules 不受影响 | exit=0：`.dev/{bin,build,test-results}` 与 `dist/` 全部消失，`.dev/` 只剩 baseline 与 byspace-home（daemon 日志、agents 等原样），`internal/webui/dist` 只剩 `.keep`，node_modules 409 项不变；随后 `npm run dev:daemon`（不带 SKIP）从零 `make build` 出 12444738 字节的 `.dev/bin/byspace` 并 listening on 127.0.0.1:6778，`npm run cli -- daemon stop` 返回 `stopped pid=23748`。日志 `.dev/baseline/after-clean-dev-daemon.log` | 通过 |
| CI 与文档路径一致 | GitHub Actions / 文档链接检查 | 检查 workflow 与 docs 引用 | 没有指向旧 `bin/` 路径的引用 | 残留 grep（排除 node_modules/dist/web/dist/internal/webui/dist/bywork/archive/.dev）剩下的 `bin/byspace` 全是安装路径、shebang 或 `.dev/bin` 自身；ci.yml 三处、release.yml 全部 dist/ 未动、docker/Dockerfile 用 `/out/byspace`、deploy-app.yml 走 `make build` + 已改的 deploy-pairing-smoke.mjs。本地跑不了 Actions，CI 的真实验证要靠推分支 | 通过（静态核对） |
| 真实浏览器一致性 | `npm run audit:browser`（dev daemon 6778） | 起 dev daemon 后跑地毯检查 | 11/11 通过，无协议校验错误 | `.dev/baseline/audit-browser2.log`：`11/11 checks passed`，exit=0。第一次跑 3/6 失败是因为二进制里嵌的是 `make build-web` 删过大 JS 的 UI（`Sidebar startup snapshot: - text: Not found`），`npm run build:daemon-web-ui && make build` 重嵌完整 UI 后同一入口全绿；跑完 `daemon stop` 返回 stopped pid=33364 | 通过 |
| 交付前自检 | `npm run typecheck` / `npm run lint` / `npm run audit -- --no-browser` / `npm run format` | 全仓检查 | 全绿 | typecheck exit=0、lint `Found 0 warnings and 0 errors`（2085 文件）、audit `Go 测试 ✔ 全部通过 (86.1s)`、入站缺口 0、出站 MISSING/OPTIONAL/NEVER_SENT 全 0、账本一致 ✔，`全部通过` exit=0；format exit=0 且未产生额外改动。日志 `.dev/baseline/{typecheck,lint,audit,format}.log` | 通过 |

## 证据与决定

- 清理前的仓库事实：`make build-android` 先写 `bin/byspace-android-arm64.apk` 再 cp 到 `dist/`（Makefile:69），同一产物两份；`make app` 把 BySpace.app 留在 `dist/`（Makefile:44-54）；`make dmg` 往 git 跟踪的 `build/darwin/` 写 dmg 暂存目录（Makefile:58-63）。
- `.gitignore:107-108` 有一条注释承认 `go build ./workers/relay/` 不带 `-o` 会在根目录掉一个 `relay` 二进制。
- 本机在跑的只有 `/Applications/BySpace.app/Contents/MacOS/byspace tray`（生产，6777），没有 dev daemon 或 vite，改路径不会打断在跑的会话。

## 完成核对

- 行为门：13 行全部通过。
- 范围门：`scope.md` 逐条对账，27 项全部「已覆盖」或「不适用」，无「未处理」。
- 契约门：`make build` 产物路径改动前存了基线（`.dev/baseline/make-build.log`、`cli-status.log`），改后同入口输出逐字相同；既有测试文件与断言未改（`git status` 无测试文件）。
- 完成门：达成（提交 7c97386ac）。
- 需要用户看的推断或无法判定：CI 只有本地静态核对与本地实跑，真实 GitHub Actions 结果要推分支才知道。

## 本轮之外的发现

- `npm run audit:browser` 对着 `make build-web` 产出的二进制会失败（3/6，侧栏 `Not found`）：该目标按设计删掉 >1MB 的原始 JS，而 webui 的压缩回退没接住首屏。用 `npm run build:daemon-web-ui` 重嵌完整 UI 后 11/11。本轮未动这条链路，留给后续判断是回退缺陷还是入口用错。
- `bywork/work/project-npm/` 仍 in_progress，卡在 v0.26.4 发布验收余项，与本轮无依赖。