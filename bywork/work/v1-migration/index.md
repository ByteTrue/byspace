---
kind: work
status: complete
current_unit: "完成"
next_action: "无"
must_hold: "v1 记录冻结不改写；外部引用与活脚本必须仍可达；不碰 .gitignore/Makefile 的用户改动"
proof_gap: ""
---

# bi v1 产物迁移到 v2

## 目标与边界

用户要求（2026-11-16）：「bi 工作流我进行了重写，现在是和 v1 完全不同的 v2 版本，你帮我对 v1 的旧产物，能迁移的进行迁移，麻烦的就归档起来，反正不要影响到 v2 的产物，对 v2 的工作产生影响就行」。

边界：v1 的 decisions/epics/issues/notes/spec/talks 是冻结记录，整体归档，不改写内容；存活的用户决定与外部事实蒸馏进 bywork/memory/；vision/index.md 按 v2 模板原地重写；所有外部引用（docs、代码注释、活脚本）改指新路径。不碰用户已有的 .gitignore 与 Makefile 改动。

## 已定方案与约束

- 归档位置 bywork/archive/v1/，六目录作为整块 git mv，内部相对链接（../decisions/ 等）随之保持可达。
- node-reaudit-log.md 被 scripts/reaudit-ledger-check.mjs:11 活读取，归档后更新 LEDGER 常量。
- spec/ 七篇是冻结时的产品真相，docs/ 已承接工程约束；外部引用改指归档路径，settings-taxonomy 引用改指 memory。
- memory 只收跨任务且不可从代码重建的判断（v2 memory-direction 过滤）；纯机制笔记随归档保留。
- 既有测试与 fixture 只读；docs-links.test.mjs 对 bywork/ 源跳过链接检查的规则不动。

## 行为证明

| 行为路径 | 真实入口                                                          | 操作                         | 应观察到                                                           | 证据                                                                                                                                                                                                                                                                                                                  | 结果 |
| ------------------- | ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| v1 六目录整体归档   | git ls-files / git status                                         | 归档后清点                   | 302 个文件在 bywork/archive/v1/ 下，旧目录为空，git 识别为 rename | git status 302 条 R；逐目录 find 计数与基线一致（decisions 8 / epics 55 / issues 176 / notes 44 / spec 8 / talks 11）；vision/index.md 留在 bywork/vision/ 原地改写                                                                                                                                                  | 通过 |
| 外部引用可达        | node scripts/docs-links.test.mjs + 全仓 grep                      | 改引用后跑链接守卫与残留扫描 | 0 broken；无活引用指向旧路径                                       | docs-links pass 2 fail 0；全仓 grep 旧路径只剩守卫自身注释；memory/vision/work 全部链接可达；归档内 238 条相对链接共 7 处断链引用（react-compiler 在同文件出现两次），目标全是移动前已失效的退役 docs（expo-router/unistyles/mobile-panels/react-compiler）与字面 path 占位，冻结保留（外部审查复核计数，2026-11-16） | 通过 |
| 活脚本仍绿          | npm run audit:ledger; node --test scripts/parity-surface.test.mjs | 更新 LEDGER 常量后运行       | 账本 512 文件一致；parity 测试通过                                 | audit:ledger 与基线逐字一致（512 · MATCH 330 · FIXED 112 · N/A 68 · DROPPED 2 · MISSING 0 · 待审 0）；parity-surface pass 4 fail 0                                                                                                                                                                                    | 通过 |
| memory 符合 v2 契约 | 逐文件对照 templates/memory.md                                    | 检查 17 个主题文件           | 每篇有 结论/依据/重访条件，只含存活判断                            | 脚本逐篇检查 # 标题 / ## 结论 / ## 依据（含 类型：）/ ## 重访条件，17/17 齐全；来源均引用 bywork/archive/v1/ 路径                                                                                                                                                                                                    | 通过 |
| vision 符合 v2 模板 | 读 bywork/vision/index.md                                        | 对照 templates/vision.md     | 三节齐全，无实现状态节，链接可达                                   | 目标世界 / 旅程与能力方向 / 候选与边界 三节；演化地图（实现状态）已删；过期 MCP 自动化表述改为 skill+CLI；链接检查全部可达                                                                                                                                                                                            | 通过 |
| 仓库检查绿          | npm run typecheck; npm run lint; npm run format:check             | 改动后运行                   | 全部通过                                                           | typecheck 无 error；lint 0 warnings 0 errors；format:check 全部合规；go test -count=1 ./internal/hostsync/ ok（注释改动编译验证）                                                                                                                                                                                     | 通过 |
| work 校验           | python3 ~/.agents/skills/bi/scripts/check_work.py                 | 完成前运行                   | 本 work ok                                                         | check_work.py --project . 输出 ok v1-migration，1/1 consistent（表头容忍 formatter 加空格，已按单元格解析）                                                                                                                                                                                                           | 通过 |

## 证据与决定

基线（改动前）：docs-links.test.mjs fail 0；audit:ledger 账本一致 512 文件（MATCH 330 · FIXED 112 · N/A 68 · DROPPED 2 · MISSING 0 · 待审 0）。v1 清单 303 文件存于 /private/var/folders/df/g_fkd79n7b503kmv28_l2myc0000gn/T/opencode/v1-baseline.txt。

移动断链修复：整块移动使逃出归档块的相对链接（../../docs/ 等）与指向 vision/ 的链接失效。用脚本按「移动前原位置解析」修复 22 条（11 个文件），只改深度不改目标；移动前已失效的 7 条（含 node-reaudit-log.md 里的字面 `path` 占位）保持冻结。

外部引用改动清单：7 条 docs 链接 + 2 条 docs 裸路径（glossary、protocol-compatibility）+ design/references/shadcn/README.md + 4 处代码注释（internal/hostsync/document.go、packages/protocol/src/messages.ts、provider-terminal-integration.tsx、desktop-window-titlebar.tsx）+ 2 个脚本（reaudit LEDGER 常量、parity-surface 两条 decision 标签）。settings-taxonomy 的两处引用（docs/terminal-activity.md、provider-terminal-integration.tsx）改指 bywork/memory/settings-taxonomy.md，其余改指归档原文件。

不提炼的笔记（scope.md 逐条注明理由）：013/014/015/017（事实已在代码守卫或 docs 里）、020（Expo/Metro 退役）、2026-10-16-menu-surface（组件已删）、2026-10-31-mock-provider（指令列表可从 mock_directives.go 重建）、2026-11-12-cli-pair（docs 已陈述红线且守卫测试在代码里）。

## 完成核对

- 行为门：7/7 通过
- 范围门：`scope.md` 由基线 303 文件机械生成（46 归档+提炼 / 256 纯归档 / 1 vision 原地改写），逐目录计数核对一致
- 契约门：共享路径（docs 引用、LEDGER 常量）有基线且改后同入口复验；既有测试未改
- 完成门：check_work.py ok，proof_gap 空，全部证明行通过
- 需要用户看的推断或无法判定：无
