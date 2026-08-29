---
kind: issue
title: "Windows Forge 创建 PR/MR 丢失正文"
type: bug
status: open
created: 2026-08-13
---

# Windows Forge 创建 PR/MR 丢失正文

GitHub issue: [#27](https://github.com/ByteTrue/byspace/issues/27)

## 做成以后是什么样

Windows daemon 通过 GitLab、GitHub 或 Gitea CLI 创建 PR/MR 时，AI 生成的多行 Markdown 正文完整到达 Forge；已解析出的真实 CLI 可执行路径同时用于能力判断和实际执行，不再把原生可执行文件的参数转交给 `cmd.exe` 解析。

**范围：** 修复共享 Forge CLI 执行边界以及 GitLab、GitHub、Gitea 三个现有 adapter；覆盖多行、中文和 Windows shell 元字符参数。**不包含：** 改变 AI 文案生成策略、引入新的 Forge API 客户端、增加创建后的远端回读。

## 为什么现在做 / 当前坏在哪

预期：在 Windows 上点击创建 MR，GitLab 同时收到生成的 title 和 body。实际：`shaky-newt` 的 MR 只有正确 title，description 为空。

问题设备的 `daemon.log` 证明正式版 `0.5.0` 在 Windows Host `zijie` 上成功处理 `checkout_pr_create_request`：临时生成 agent 正常完成，约 73 秒后返回成功，没有 glab 或结构化生成错误。生成 schema 要求 title/body 同时存在，fallback 也包含正文，因此正文是在后续 CLI 提交边界丢失。

当前三个 adapter 都先用 `findExecutable` 解析 `glab`、`gh` 或 `tea`，却只把结果用于“是否安装”判断；共享 runner 实际仍执行裸命令名。Windows 的 `execCommand` 会将无路径、无扩展名的裸命令交给 `cmd.exe`，使多行 Markdown 正文再次经历 shell 解析。相同责任边界影响三个 Forge adapter，不能只在 GitLab 创建 MR 处补丁。

## 动哪些、验哪些

- 共享 Forge runner 接收并执行 adapter 已解析出的绝对可执行路径。
- GitLab、GitHub、Gitea 的每次 CLI 调用都把 resolved path 交给 runner；保留 GitLab、Gitea 现有的 service-instance path 缓存，GitLab auth probe 同样遵守。
- 自托管 Host 的共享 auth probe 执行它已经解析出的路径，而不是再次执行裸命令。
- 回归测试用真实子进程证明多行中文及 `& | ! ^ < > ( )`、引号保持为一个原样 argv。
- 目标 adapter 测试证明 resolved path 被传至 runner，现有命令参数、host env、错误分类和既有缓存行为不变。

相关质量承诺：

- **兼容性 / 互操作性：** Windows 上三个已支持 Forge CLI 的多行参数保持字节级内容，不经 shell 重解释；以真实子进程测试和三 adapter 测试举证。
- **可靠性：** CLI path 的缓存、缺失检测、认证和错误分类保持现状；以现有目标测试回归举证。
- **可维护性 / 可测试性：** 在共享 runner 边界修一次，不为三个创建入口复制转义逻辑；以独立 review 和 diff 检查举证。

## 验证

先增加会在旧实现上失败的共享 runner 测试，再实施修复并运行：

- `packages/server/src/services/forge-cli-command.test.ts`
- `packages/server/src/services/gitlab-service.test.ts`
- `packages/server/src/services/github-service.test.ts`
- `packages/server/src/services/gitea-service.test.ts`
- 根 `npm run format`、`npm run typecheck`、`npm run lint`
- 独立 review

真实 Windows + GitLab 的原始操作需在包含修复的发行版上最终复测；本 issue 不以 macOS shell 行为冒充 Windows 实机验收。

## 执行记录

- 共享 Forge runner 现在显式接收 adapter 解析出的 `executablePath`，并把它交给 `execCommand`；Windows 上 `.exe` 绝对路径因此走原生 argv，不再因裸命令名进入 `cmd.exe`。
- GitHub、GitLab、Gitea 的主 runner 调用均传递 resolved path；GitLab 的独立 auth 调用、共享 host auth probe、Gitea host/family probe 也改为执行已解析路径。
- 回归测试先在旧实现上失败：共享真实子进程测试执行了不存在的裸命令；三 adapter path 断言收到 `undefined`。修复后测试覆盖多行中文、shell 元字符、引号、三个 adapter path 传递、GitLab auth path 以及 GitHub create-PR body argv。
- 验证通过：四个目标测试文件共 205/205；根 `npm run format`、`npm run typecheck`、`npm run lint` 和 `git diff --check` 通过。服务端改动不涉及 App，因此无需 Web export。
- 独立 review 首轮发现 Gitea host/family probe 仍执行裸 `tea`，已修复；focused re-review 无 blocker。其 GitHub path 缓存建议不采纳：GitHub 原有行为是每次解析，缓存不是本次正文修复所需；issue 已澄清仅保留 GitLab/Gitea 的既有缓存语义。
- 当前残余证据缺口：尚未在包含本修复的 Windows 构建上向真实 GitLab 创建 MR。issue 保持 open，待发行后实机复测再关闭并回写稳定事实。

## 关闭时

- 回写到 project spec 或 notes 的候选：若修复确认，`codestable/spec/index.md` 的 Git 与 Forge 稳定事实补充“resolved 原生 CLI 直执行、参数不经 shell”。
- 关闭判断：自动化覆盖共享边界，三 adapter 回归和静态检查通过，独立 review 无 blocker；Windows 实机证据缺口必须明确记录，未经用户授权不关闭。
