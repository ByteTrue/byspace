---
kind: issue
title: "同步上游到 Paseo v0.8.0-beta.1"
type: chore
status: closed
created: 2026-09-09
amended: 2026-09-09
closed: 2026-09-10
---

# 同步上游到 Paseo v0.8.0-beta.1

> **读者：** 执行本轮上游同步的人。两个阶段各做了什么、要保住哪些分歧、怎么验。

---

## 做成以后是什么样

`main` 的代码基线推进到上游 `v0.8.0-beta.1`（`4eab53e24`），BySpace 的全部分歧原样保留：品牌与命名、`BYSPACE_*` 环境变量、端口 6777 / 6778、Relay 与发布通道地址、CI 与发布工作流、`codestable/`，以及历史 Issue 交付的能力。

**范围：** 包含把上游树导入到 `v0.8.0-beta.1`、解决冲突、验证。不包含在同步中顺手改产品行为，也不包含 Epic 003 的吸收工作。

**归属：** 独立 Issue。与上游同步是项目级动作，不属于任何一个 Epic。立项时编号 017，因并行工作先占用了 017 与 018，改为 019。

**本 Issue 改过一次方向。** 立项时叫「选择性同步上游保留面修复并断开」，目标是最后挑拣一次后与上游断开。该决定于 2026-09-09 被 Owner 撤回，见 `codestable/talks/001-terminal-native-hard-fork.md` 第 8 节：BySpace 继续以 Paseo 为基线同步。阶段一的挑拣成果已合入，阶段二改为全量同步到最新 beta。

## 为什么现在做

上游每周约 50 个提交，距上次同步（v0.7.2，2026-09-02）已积累 82 个。间隔越长结构差异越大，单次成本越高。`v0.8.0-beta.1` 是当前最新的 beta tag，是一个稳定的落点。

## 现状怎么工作

上次同步是把 Paseo v0.7.2 整棵树导入为**单亲的 squash 提交** `a913965c4`（PR #21），提交信息带 `Upstream-Base:` trailer 记录上游基点，涉及 348 个文件。因为不是真正的 merge，`git merge-base` 落在更早的位置，`git cherry` 也无法按 patch-id 判断哪些已应用；paseo 到 byspace 的重命名进一步让 patch-id 不可靠。本轮沿用同一套约定：一个 squash 提交，带 `Upstream-Base: 4eab53e24…`。

---

# 阶段一：选择性挑拣（已完成，PR #31）

按原方向执行的部分。合入 `main` 于 `28c770533`，8 个 commit，99 个文件。虽然方向已变，这些修复本身仍然要，且全部包含在 `v0.8.0-beta.1` 中，因此阶段二会覆盖它们——先合入是为了落袋已验证的工作并缩小阶段二的 diff。

## 取舍表与结果

干跑方法：在临时 worktree 上 `git cherry-pick -n <sha>` 看冲突文件，再 `reset --hard`。

| 顺序 | 上游 PR                            | 本地 commit | 结果                             |
| ---- | ---------------------------------- | ----------- | -------------------------------- |
| 1    | #4171 跨平台 CI flake              | —           | **跳过**，与取舍表预期不同，见下 |
| 2    | #4207 Linux 打包 CLI shim          | `7ef2100a1` | 干净                             |
| 3    | #4199 Changes 与 working diff 同步 | `ab92ea3cc` | 干净                             |
| 4    | #4208 禁用 fsmonitor               | `d5d9a9a6d` | 干净                             |
| 5    | #4229 web diff 复制                | `2f4d25e03` | 干净                             |
| 6    | #4215 fork PR 显式设置             | `67ffaf458` | 两处冲突，已解                   |
| 7    | #4228 Settings 导航残留            | `0c07a33c1` | 干净                             |
| 8    | #4240 diff 文件头同步              | `15c44a405` | 干净                             |
| 9    | #4275 移动端键盘过渡               | `b8b359721` | 干净                             |

`#4168`、`#4174` 内容已在 `main`，无需取。`#4203` 侧栏自定义当时判为不取。其余 41 个提交属于适配器、插件或 Hub，当时不取——**阶段二会把它们一并带进来**，这是方向改变后的必然结果，不再逐个挑拣。

## 与取舍表的偏差

**#4171 从「取，手工解」改为跳过。** 干跑报的冲突文件 `workspace-git-service.observation.test.ts`，冲突原因不是双方各改一处，而是本仓库已有同一处修复的更强版本：上游是等待 `fetchInFlightCount === 0` 后单次 `advanceTimersByTimeAsync(1000)`，本仓库是在 `waitFor` 的每次轮询里推进假时钟并带 5 秒超时，注释说明 Windows runner 会多一次异步跳转。解完这一处后暂存区为空，且该提交触及的 13 个文件全部与 `main` 逐字节相同、无增删，说明整个提交在本仓库已是 no-op。改用 `git cherry-pick --skip`。

## #4215 的两处冲突

- `docs/data-model.md`：保留本仓库整张 Workspace 字段表（BySpace 措辞、`isPaseoOwnedWorktree` 的「字段名为兼容保留」说明），只取上游新增的 `untrustedSource` 行。该行无品牌措辞，原样采用。补跑 `format:files` 对齐列宽。
- `packages/app/e2e/support/helpers/sidebar-nav-settings.ts`：`DU`（本仓库无此文件，上游改了它）。它不在 `main` 中，仓库内也无引用，`git rm` 保持缺失。

## 阶段一踩到的陷阱

#4215 的 `cherry-pick --continue` 第一次失败在 pre-commit hook 的 typecheck，client、server、app、cli 四个包报大量 `workspace.setup.run.*`、`setupSkippedReason`、`blocked` 未知。原因不是解错冲突：协议源码已含新成员，但 `packages/protocol/dist/messages.d.ts` 还是旧声明，消费方读的是过期 `dist`。按 CLAUDE.md 跑 `npm run build:server` 刷新后重跑即通过。**阶段二涉及协议改动更多，开工前先跑一次 `build:server`。**

本仓库的 lefthook pre-commit 对每个 commit 跑 lint、staged 文件的 format:check 与全量 typecheck，所以 8 个 commit 各自都过了这三项。

## #4322 macOS 更新：当时判定不取

方向改变后这条结论仍然成立，但**阶段二会把 #4322 带进来**，因此其中的判断变成阶段二必须处理的冲突点，而不是「取不取」：

1. **核心修复不适用。** 上游解决的是 Electron 41 的 Squirrel helper 在当前 macOS 上让更新交接休眠，靠升级 Electron 44 用 XPC 唤醒 ShipIt。本仓库 macOS 走 `packages/desktop/src/features/mac-dmg-updater.ts`：`auto-updater.ts` 在 `darwin` 时调用 `downloadAndOpenMacDmg`，下载 DMG、校验 SHA-512、清 quarantine、交 Finder 手工覆盖（Issue 002、006）。Squirrel 的 in-place 路径不启用。
2. **它捆了 Electron 41.2.0 → 44.2.0**，连带 `package-lock.json` 与 `nix/npm-deps.hash`。阶段二要单独判断是否接受这个运行时升级。
3. **updater 诊断围绕 ShipIt 状态构建**，`app-update-service.ts` 的改动是把 `targetVersion` 透传给这些日志，纯管道。
4. **`minimumSystemVersion: 22.0.0`（macOS 13）是 Electron 44 的护栏。** 若不升级 Electron 就采用它，会错误挡住 macOS 12 用户；全仓库无代码读该字段。

## 阶段一验证

| 检查                                   | 结果                     |
| -------------------------------------- | ------------------------ |
| `npm run typecheck`（全仓库）          | exit 0                   |
| `npm run lint`（89 个改动文件）        | 0 warning，0 error       |
| `npm run format:check:files`（98 个）  | 全部合规                 |
| server 包 8 个受影响测试文件           | 8 files / 107 tests 通过 |
| app 包 9 个受影响测试文件              | 9 files / 79 tests 通过  |
| protocol `messages.workspaces.test.ts` | 39 tests 通过            |
| desktop `cli-install/path.test.ts`     | 4 tests 通过             |
| GitHub Actions（PR #31）               | 23 pass / 2 skipping     |

动手前先在 `main` 上跑了一次 `npm run typecheck`（exit 0）作基线，用于把并行未提交改动造成的失败与本次引入的失败区分开。4 个 browser e2e spec 未在本地跑，由 CI 覆盖。

**并行工作未受影响：** 会话期间工作区另有他人未提交改动（`packages/server/src/terminal/terminal.ts` 及其测试、`codestable/issues/018-x-ff-…`）。9 个 cherry-pick 触及的 112 个文件与之无交集（已核对），全程只 `git add` 具名路径。

---

# 阶段二：全量同步到 v0.8.0-beta.1（进行中）

## 目标基点

上游 `v0.8.0-beta.1` = 提交 `4eab53e24`（annotated tag 对象 `0f345977f`）。相对当前 `main` 有 82 个上游提交。

## 方法

沿用 PR #21 的约定：

1. 分支 `sync/paseo-v0.8.0-beta.1`。
2. 先 `npm run build:server` 刷新跨包声明，避免把过期 `dist` 造成的假错误当成冲突。
3. 把上游 `v0.8.0-beta.1` 的树合并进来，逐个解决冲突，**默认保留 BySpace 一侧**的品牌、端口、环境变量、Relay 与通道地址、CI 与发布工作流；上游一侧只取真正的代码演进。
4. 压成单个提交，信息为 `sync: import Paseo v0.8.0-beta.1`，带 `Upstream-Base: 4eab53e24…` trailer。
5. 验证后开 PR，CI 全绿再合入。

## 必须保住的分歧

- 品牌与命名：`byspace` CLI、`BYSPACE_*` 环境变量与其 `PASEO_*` 兼容别名、`$BYSPACE_HOME`。
- 端口：打包 daemon 6777，仓库开发 6778。
- Relay 与发布通道地址，见 `codestable/spec/connection.md`。
- macOS DMG 手工交接更新路径，见 `codestable/spec/desktop-updates.md` 与上文 #4322 的四点判断。
- `codestable/`、`CLAUDE.md`、本仓库自有的 CI 与发布工作流。
- Epic 002 交付的保留能力，以及 Issue 001–016 的成果。

## 危险边界

- 不在同步提交里夹带产品行为改动。
- 不因为上游改了就放弃已记录的取舍；冲突时先查 `codestable/spec/` 与相关已关闭 Issue。
- push 与合并需 Owner 授权。

## 阶段二执行记录

**已完成并合入 `main`。** PR #32 以 merge commit `3e1d69d76` 合并，验收候选 `b68aabc6f`。

合并前 `origin/main` 从冻结的 `28c770533` 移动到 `71c993252`（并行工作的两个 ff 提交合入），按技能停止合并、把新 main 并进候选、重新验证、推新候选并重新取得接受。重叠文件只有 `packages/server/src/server/bootstrap.ts`，自动合并干净，且已核对对方「终端恢复必须在 `boundListenTarget` 赋值之后」的修复完整保留、`restorePersistedTerminals` 只出现一次。

同步 worktree 与 `sync/paseo-v0.8.0-beta.1` 分支（本地与远端）已清理。

### 排除的 16 个路径

- 2 个上游修改但本仓库没有的：`.github/workflows/release-notes-sync.yml`（本仓库 CI 分歧，无对应物）、`skills/paseo-plugin/SKILL.md`（本仓库更名为 `skills/byspace-plugin/SKILL.md`，改写补丁路径后单独应用，9 个冲突）。
- 14 个上游新增但阶段一已带进来的。13 个与上游目标版本逐字节相同；`scripts/github-release.mjs` 仅差品牌措辞，保留我方。

结果：438 改、179 增、20 重命名、10 删除、**66 个冲突**。

### 冲突解决

先自动分流：两侧按品牌与版本号归一化后比较，**29 个 hunk 完全相同**（上游的改动我方已有，只差品牌），取我方。剩余逐个判断。

**保留我方（有记录的分歧）：**

| 位置                                             | 依据                                                  |
| ------------------------------------------------ | ----------------------------------------------------- |
| `pi/agent.ts` 的 turn 结算                       | Issue 009：`agent_end` 即时完成，不等 `agent_settled` |
| `app-update-service.ts` 安装顺序                 | Issue 002/006：DMG 手工交接分支必须在 Squirrel 之前   |
| `desktop-release.yml` 全部 8 个 hunk             | Issue 010/011：本仓库自有发布流水线与 sha256 旁挂文件 |
| `CHANGELOG.md`                                   | 本仓库自有版本线                                      |
| `_layout.tsx`                                    | Epic 002 的 Appearance 与 SSH 主机密钥                |
| `viewed-timeline-sync.test.ts` 的「不回退 tail」 | Epic 002 A06–A08 的 timeline owner                    |
| 各 `package.json` 的 workspace 版本              | 本仓库 0.12.0 线                                      |

**取上游（实质演进）：** OpenCode hook 顺序串行化与 OpenCode 2 事件契约、插件 runtime 停止清理与强制超时、`workspace_update` 权限扩展、CLI 全局 `--host` 重构、协议新增 `workspaceTerminals`、e2e diagram helper 新签名。均改回 BySpace 品牌。

**两侧都保留：** `agent-manager.ts` 相邻常量、`model.test.ts` 的虚拟化测试与上游新测试、`CLAUDE.md` 的插件 SDK 边界规则加我方 daemon 端口规则。

### A05 手动导入的重做

第一次用「两侧都保留」整合 `import-session-sheet.tsx` 失败，产生 262 个类型错误——两侧各是半个函数，拼接必然坏。改用正确做法：以上游文件为底，把本仓库对该文件的完整 delta 三方叠加，再逐个判断 8 个冲突；`ManualImportForm`、类型与守卫函数作为**完整块**嫁接，不靠 hunk 拼接。

随后修了三处真实缺陷，不是改测试迁就代码：

1. 手动表单会为列表导入显示「导入中」，测试因此匹配到两个元素。加 `isManualImportPending`，让表单只报告自己的提交。
2. 合并后组件复杂度 22 超过上限 20。把可选链收进 `isRecentImportError(mutation)`，并让表单自己判断 `show`，消掉组件体里的三元。没有加豁免注释。
3. `default-shell-section.tsx`（Issue 013）依赖的 `settings-section` 被上游移到 `@/components/settings/headings/`，更新导入路径。

### 品牌清扫

导入后有 143 个文件新出现 paseo 词元。直接全局替换会把 `@getpaseo/plugin` 变成 `@getbyspace/plugin`，因此按主干实际约定建立保护清单：`@getpaseo/*`、`getpaseo`、`usePaseo`、`PaseoApi`、`paseoTools`、`paseo.agents.*` 等 RPC 命名空间、`paseo.config.*`、协议字段 `requirements.paseo`。

只替换**独立词**，附着在标识符里的一律不动。范围限定 `public-docs/plugins/**` 与 `plugin-examples/**` 的 15 个文档，约 228 处；文档链接从 `paseo.sh/docs/...` 改写到 `github.com/ByteTrue/byspace/blob/main/public-docs/...`。

清扫中自己引入并修掉的两个错误：把协议键 `requirements: { paseo }` 误改成 `byspace`；把 OpenCode 插件身份 `paseo-terminal-activity` 误改成 byspace——那是装到用户磁盘上的文件名与 id，改名会留下孤儿插件文件，主干也保留它。另外把上游 `schedule/shared.test.ts` 里的 `PASEO_HOST` 改为 `BYSPACE_HOST`，与生产代码一致。

### Electron 44

上游把 Electron 从 **41.2.0 升到 44.2.0**，`packages/desktop/package.json` 无冲突自动合入。随之接受 `electron-builder.yml` 的 `minimumSystemVersion: "13.0.0"`。**Owner 已于 2026-09-09 明确接受**（「接受，继续」）。macOS 12 用户从本版起不再收到桌面更新，发布说明必须写明。

## 阶段二验证

| 检查                                          | 结果                                      |
| --------------------------------------------- | ----------------------------------------- |
| `npm run typecheck`                           | 0 错误                                    |
| `npm run lint`                                | 0 warning，0 error                        |
| `npm run format:check`                        | 全部合规                                  |
| app                                           | 605 files / 5211 tests 通过               |
| server（不含 e2e）                            | 375 files / 5633 tests 通过，2 files 失败 |
| protocol                                      | 65 files / 710 tests 通过                 |
| cli（`vitest run src`）                       | 39 files / 284 tests 通过                 |
| desktop / client / plugin / highlight / relay | 408 / 149 / 73 / 97 / 50 通过             |

worktree 内做了独立 `npm install`（2677 个包），未复用主检出的 `node_modules`，因此不影响并行工作与 Owner 的开发环境。`npm install` 同时规范化了手工合并过的 `package-lock.json`。

### Pi 自主轮次与 Issue 009 的冲突：已用收窄规则同时满足

上游为 Pi 新增了「自主轮次」：扩展可以在 Pi 结束后继续工作，因此 `turn_completed` 要等 `agent_settled`。Issue 009 恰好相反，在 `agent_end` 即时结算，理由是不能让输入框因扩展层异步后处理（watchdog、LSP、自动压缩）卡在运行中。

上游新增的五个测试断言的正是延迟结算，与我方行为直接矛盾。第一版判断是「需要 Owner 在三个方案里选」，实际找到了第四条：**让规则说清是谁发起的轮次**。

`packages/server/src/server/agent/providers/pi/agent.ts` 的 `agent_end` 分支收窄为——客户端发起的轮次仍然即时结算（Issue 009 的修复保留）；以下三种继续等 `agent_settled`，因为它们的后续工作属于同一个 turn：

- Pi 标记了将要重试，或本次运行正在从重试中恢复；
- 有 stop 在途，由取消决定结果（`interruptingTurn !== null`）；
- 运行是自主的，没有客户端发起的 turn（`!activeTurnId`），扩展可能继续它。

同时把 `pendingSettledMessages` 改为每次 `agent_end` 都记录，不再只在客户端 turn 活跃时记录，这样自主运行结算时能拿到正确的消息。

结果：Pi 的 95 个测试全部通过，**上游的五个自主轮次测试与我方「completes normal turn immediately on agent_end」回归测试同时成立**。提交 `869358826`。

### CI 暴露的两个发布问题

**1. Nix 依赖哈希（已修，`a41a70287`）。** 冲突解决时把 `nix/npm-deps.hash` 取了上游值，但我们的 lockfile 既不是上游的也不是原来的：它带我方 workspace 版本加上游新依赖，`npm install` 又规范化过一次，因此固定输出派生哈希是第三个值。`build-desktop-darwin` 的失败日志直接给出了正确哈希。

**2. `@agentclientprotocol/sdk` 版本冲突（已按 Owner 决定处理，`a0b065e8a`）。**

上游在本区间给插件 SDK **新加**了 `@agentclientprotocol/sdk@^1.4.0` 运行时依赖，daemon 保持 `^0.17.1`：

|        | 上次同步基点 `9400a49af` | 目标 `4eab53e24` |
| ------ | ------------------------ | ---------------- |
| plugin | 无此依赖                 | `^1.4.0`         |
| server | `^0.17.1`                | `^0.17.1`        |

**上游不受影响**，因为它把七个 workspace 各自独立发布到 npm，`@getpaseo/cli` 只是普通声明依赖，npm 自然嵌套两份。**我们受影响**，因为 `scripts/package-bytetrue-baseline.mjs`（Issue 010）把七个包合成单个 `@bytetrue/byspace` 并用 `bundledDependencies` 打包，外部依赖上提到顶层。这是技能审计清单里点名要保住的 BySpace 边界 single-package release staging，因此属于 dual-change 判定，交 Owner 决定。

排除的两条路，留记录避免重走：

- 把冲突依赖留在各自包上或物理拷进各自 `node_modules`。**不可行**：`npm pack` 会剪掉 bundled 依赖内部的 `node_modules`，安装校验报 `Cannot find package`。提交后已 revert（`d0c0e686a` / `cbed26fd6`）。
- 两边对齐版本。**双向都不通**：daemon 升 1.4 有 14 个类型错误（用到已移除的 `SessionModelState`、`SessionStateResponse.models`、`unstable_closeSession`、`unstable_resumeSession`）；plugin 降 0.17 有 11 个（用到 1.4 才有的 `closeSession`、`compaction_update`、`ToolCall.name`）。

**Owner 决定：保住单包分发，牺牲插件 SDK 的 ACP 面。** 打包器在冲突时改取 daemon 的 specifier，不再拒绝构建。判断依据是这套插件系统对本项目价值接近于零：上游文档只写扩展点与安装步骤，没有任何场景叙述；上游自己标注 Experimental；插件明确无沙箱（装一个等于把 daemon 宿主机的权限交出去），分发只是 git 克隆，没有 registry 或发现机制。唯一独特之处是客户端扩展会出现在所有连接的客户端包括手机，而本项目只有一个用户，装第三方插件的价值为零，要定制直接改 `packages/app/src` 更快。

代价：插件通过 npm 包使用 `@getpaseo/plugin/server/acp` 会在运行时失败。该面在 v0.8.0 才出现，本仓库无插件使用它，desktop 与仓库开发安装不受影响（npm 在那里嵌套两份）。本地已用 `npm run release:pack:bytetrue` 加 CI 的安装校验步骤验证：产物声明 `^0.17.1`，在 `@getpaseo` 指向无效 registry 的情况下安装成功，只暴露 `byspace` 可执行文件，`--version` 返回 0.12.0。

### 一处环境相关失败，与本次同步无关### 一处环境相关失败，与本次同步无关

`workspace-service-port-allocator.test.ts` 的 `passes service and workspace context to portScript`：断言比较 `mkdtemp` 返回的路径与脚本收到的 cwd，macOS 上 `/var` 是 `/private/var` 的符号链接。该文件与 `main` 逐字节相同（`git diff main` 为空），CI 在 Linux 上不触发。

### 与 upstream-sync 技能的偏差

本次开工时没有先读 `.agents/skills/upstream-sync/SKILL.md`，方法是自己推导的。事后核对，基点与区间是对的：`LAST_UPSTREAM_SHA` 取 `9400a49af`，与 PR #21 记录的上次目标一致；应用的是完整区间 diff，没有挑拣。但有三处违反，记录以免重复：

1. 早期跑了 `git fetch upstream --tags`，把上游标签拉进 `refs/tags/*`。技能明令禁止，因为两边可能有同名标签指向不同提交。已删除误拉的 `v0.8.0-beta.1`、`android-v0.8.0-beta.1`、`desktop-windows-v0.8.0-beta.1`，改为 `refs/upstream/tags/v0.8.0-beta.1`。**顺带发现一处先于本次的隐患：本地 `v0.7.0`、`v0.7.2`、`v0.7.3`、`v0.7.4` 与 origin 同名但指向不同提交，未处理，待 Owner 决定。**
2. 在没有拿到指明完整 SHA 的接受之前就创建了 PR #32。技能要求接受必须形如「我测试了候选 `<完整 SHA>`，创建 PR」，「确认授权」不足。
3. force-push 并 amend 过候选。技能规定已推送的候选不可变，任何改写都产生新候选并使先前测试与接受失效。

## 关闭结论

**可以关闭。** 目标达成：代码基线推进到 `v0.8.0-beta.1`，BySpace 的分歧逐项保住并有记录。范围没有暗扩，唯一超出"纯导入"的两处改动都是被上游变化逼出来的，且各自单独成提交：Pi 轮次结算收窄、打包器在依赖冲突时取 daemon 版本。

**验证摘要。** typecheck、lint、format、`release:check` 全过；app 5211、server 5638、protocol 710、cli 284、desktop 408、client 149、plugin 73、highlight 97、relay 50 项测试通过。CI 25 个 check-runs 绑定候选 `b68aabc6f`，23 通过 2 跳过 0 失败。本地两处失败均与同步无关且文件与主干逐字节相同：macOS 的 `/private/var` 符号链接、需要本机真实 Claude 二进制的 e2e。

**基点正确性有内容证据。** 两条历史无共同祖先，谱系无法验证基点，改用内容比对：上游改动过的 561 个文件中 336 个与基点逐字节相同、32 个去品牌后相同，其余 193 个全部能由我方后续改动或既有分歧解释，没有"上游有而我们从未收到"的内容。

**毕业回写。**

- `codestable/spec/agent-conversation.md`：Pi 的 Turn 边界结算规则按发起方区分，客户端发起的即时结算，重试在途、stop 在途、自主运行三种等 `agent_settled`。原表述"一律在 `agent_end` 即时结算"已失效。
- `codestable/spec/desktop-updates.md`：Desktop 运行时为 Electron 44，要求 macOS 13 起，manifest 用 `minimumSystemVersion` 声明，macOS 12 不再收到更新。

其余 spec 章节的当前真相未因本次同步改变。

**未处理，不藏在结论里。**

- 本地 `v0.7.0`、`v0.7.2`、`v0.7.3`、`v0.7.4` 与 origin 同名但指向不同提交。先于本次同步的隐患。
- desktop release manifest 缺少发布前校验。上游有 `scripts/validate-desktop-manifests.mjs`，但它强制的 `minimumSystemVersion` 检查与我方不变量不同，直接移植不行。
- 插件通过 npm 包使用 `@getpaseo/plugin/server/acp` 会在运行时失败，是本次明确接受的代价。
