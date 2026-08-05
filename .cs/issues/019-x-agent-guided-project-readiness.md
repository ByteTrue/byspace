---
kind: issue
title: "Agent-guided project readiness setup"
type: feature
status: closed
created: 2026-08-05
epic: ""
---

# Agent-guided project readiness setup

## 目标

用户从 Project Settings 或 Agent 对话发起项目设置后，BySpace Agent 能检查仓库是否适合在干净 worktree 中重复准备和并行开发，主动指出用户尚未意识到的缺口，给出有证据的最小建议；用户确认后，Agent 修改必要的项目脚本与 `byspace.json` 并验证结果。

## 范围

- 包含：新的 bundled `byspace-project-setup` Skill；跨语言的 project-readiness 判断模型；建议分级与确认协议；对现有 `byspace.json` 的保留式更新；必要时建议并新增最小项目原生脚本；Project Settings 的 Configure/Review with agent 入口；Skill 安装/更新前置状态；用户文档、打包覆盖与跨技术栈 eval。
- 不包含：CI/CD、生产部署、监控、发布流水线等完整 DevOps 顾问；按技术栈强塞脚手架；自动选择测试框架；未经确认复制 secrets、创建/删除数据库或执行破坏性 teardown；自动发送 Agent prompt。

## 归属

- 独立 issue。
- 相关 spec：`.cs/spec/index.md`；Web + daemon 产品边界不变，Skill 文件操作仍由目标 Host 上的 Agent 执行。

## 背景与证据

- 当前 Project Settings 已把 `byspace.json` 的主要字段做成表单，但用户仍需自己理解 worktree setup、scripts/services、动态端口和 metadata instructions，并自行判断项目缺什么。
- 仓库内已有五个 daemon-bundled BySpace Skills，daemon 负责安全安装到 `~/.agents/skills` 与 `~/.claude/skills`；新 Skill 可沿同一分发与所有权机制交付。
- 当前 BySpace 仓库自身的配置说明真实需求不止“复制已有命令”：`npm ci`、开发状态播种、server build、daemon/app 的动态端口和相互发现，都需要结合锁文件、脚本、环境变量及项目文档推断。
- 用户确认核心边界：让干净 worktree 可重复准备、让高频动作可发现、让长期服务可并行运行；Skill 应主动发现未知缺口，而不是等待用户列配置项。

## 现状如何工作

用户打开 Project Settings 后手工填写 worktree lifecycle hooks、scripts/services 和 metadata instructions；页面读写目标 Host 仓库根目录的 `byspace.json` 并保护 stale writes，但不会检查仓库、解释缺口或生成项目原生脚本。Bundled Skills 只能从 Host → Agents 统一安装，Project Settings 没有 Agent-assisted 入口。

## 影响范围

- 必须修改：`skills/` bundled 内容、daemon Skill 白名单与打包测试、server capability、Project Settings 入口和 draft navigation、i18n、用户文档。
- 需要验证：旧 daemon capability gate；未安装/需更新/已安装 Skill 状态；Agent draft 的 Host、project、cwd 与 prompt；现有配置保留；不同技术栈建议质量；包含 Skill 的 npm 包。
- 仍待调查：无。

## UI 变化

- 角色与入口：用户在某个可编辑项目的 Project Settings 中，让 Agent 检查并完善该项目的 BySpace readiness。
- 图示状态：目标。

```text
┌─ Project settings ──────────────────────────────────────┐
│ Project name                               ● Host       │
│                                                         │
│ Project setup                                           │
│ Let an agent inspect worktree setup, services, and      │
│ common project commands.       [Configure with agent]   │
│                                [Review with agent]       │
│                                                         │
│ Worktree lifecycle hooks                                │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

- 交互与关键状态：无配置时显示 Configure，有配置时显示 Review；点击后先确保目标 Host 的 bundled Skills 为最新，必要时经确认安装/更新；随后打开该项目的新 Workspace draft，预填显式要求使用 `byspace-project-setup` 的 prompt，但不自动发送。加载、安装、失败与旧 Host 均留在原上下文显示明确状态。
- 稳定约束：目标 Host 与项目必须沿当前 Project Settings 选择；旧 daemon 不走无 Skill fallback；用户仍可继续使用现有表单手工编辑。
- 仅作示意：具体卡片文案和按钮布局沿现有 Settings 组件与响应式样式。

## 质量目标

- 功能适宜性：
  - 目标：Skill 在 Node、Python、Rust、library 与多服务仓库中，只基于仓库证据提出能改善干净 worktree 准备、高频操作或并行服务的建议；确认后生成有效且最小的改动。
  - 来源：用户决定。
  - 预期证据：跨技术栈 with-Skill/baseline eval、代表性输出人工复核、配置结构检查。
- 交互能力：
  - 目标：用户无需先知道 Skill 名称或 `byspace.json` 字段即可从 Project Settings 到达已选 Host/项目的预填 Agent draft，并在发送前看见和修改 prompt。
  - 来源：当前门槛与本次风险扫描。
  - 预期证据：路由/draft 单测与真实 Web E2E。
- 兼容性：
  - 目标：新客户端面对不包含该 Skill 的旧 daemon 只显示升级 Host 提示，不尝试无 Skill fallback；新 capability 为可选字段。
  - 来源：项目协议规则。
  - 预期证据：协议、feature gate 和 UI 状态测试。
- 可靠性与信息安全性：
  - 目标：Skill 保留已有配置和未知字段，不把推测写成事实；secrets、共享资源、数据删除与破坏性 teardown 必须单独说明并取得确认；入口安装失败不得丢失用户上下文或伪装成功。
  - 来源：本次风险扫描。
  - 预期证据：Skill eval 断言、daemon 真实文件系统测试、UI failure-state 测试。
- 可维护性：
  - 目标：Skill 用“仓库证据 → 开发摩擦/并行风险 → 建议 → 具体改动”的通用判断模型，不维护按框架展开的脚手架矩阵；bundled Skill 列表和打包检查包含新目录。
  - 来源：用户决定与实现经济性。
  - 预期证据：Skill 结构复核、server/package 测试。

## 方案判断

保留 Project Settings 表单作为精确手工编辑器，把项目理解和主动建议交给 Agent Skill；不在 Web 客户端实现一套按技术栈分支的生成器。Skill 的用户入口名为 `byspace-project-setup`，内部判断模型称为 project readiness。

建议必须形成“仓库证据 → 可观察开发摩擦或并行风险 → 建议 → 具体改动”链路，并分为需要处理、值得添加、暂不建议、需要确认。没有证据时省略，不以通用最佳实践填满项目。

Project Settings 只准备 draft，不直接创建或发送 Agent。daemon 通过新的可选 capability 声明 bundled 版本包含该 Skill；入口复用现有 Skills 安装 RPC，避免在旧 Host 上假装可用。

## 实现设计

### 这次要怎么做

新增一个短 `SKILL.md` 负责触发、工作阶段和输出协议，将跨语言 readiness 规则、`byspace.json` 结构与安全边界放进按需 reference。加入可执行 eval 输入，先验证 Skill 是否比无 Skill baseline 更主动、具体且克制。

Project Settings 新增 Agent-assisted setup 卡片。卡片读取目标 Host capability 与 bundled Skills 状态；可用时创建独立 new-workspace draft id，将 prompt 写入现有 draft store，并通过现有 `/new` route 携带 Host、projectId、repoRoot、displayName 和 draftId。未安装或 drift 时，点击动作沿现有确认语义安装/更新后继续；旧 Host 显示升级提示。

### 功能 / 责任怎么分工

- Skill：检查仓库、判断 readiness、与用户确认、修改和验证。
- Agent：在目标 Host 的项目 cwd 中执行 Skill，拥有正常文件工具和项目上下文。
- Project Settings：发现入口、前置能力/安装状态、准备 Agent draft；不复制 Skill 规则。
- daemon：继续拥有 bundled Skill 资源、白名单、安装所有权和 capability。

### 请求 / 数据 / 调用怎么走

Project Settings → 当前 selected Host capability/status → 必要时安装/更新 bundled Skills → 写入本地 draft store → `/new` 选择相同 Host/project/cwd → 用户检查并发送 → Agent 加载 `byspace-project-setup` → 扫描仓库并返回建议 → 用户确认 → Agent 修改与验证。

### 哪些边界不碰

- 不新增“生成配置”RPC，也不让 daemon 猜项目技术栈。
- 不从 Settings 自动发送 prompt 或直接修改仓库。
- 不把 Skill 缺失降级为普通无指导 Agent prompt。
- 不扩展现有 Project Settings 表单字段。
- 不自动 commit、push、部署或执行破坏性项目操作。

### 质量目标如何落实

- 通用规则按项目行为和证据分类，而非语言/框架名称；用多技术栈 eval 防止 npm/Web 偏置。
- 入口锁定 selected Host、projectId 与 repoRoot，并为每次点击使用独立 draft id，避免覆盖用户现有 New Workspace 草稿。
- capability 与安装状态共同证明 Skill 可用；失败保留在卡片并允许重试。
- Skill 在写入前展示建议与具体文件变更，危险/秘密相关动作单独确认；已有文件做保留式编辑。

### 一步步怎么改

1. 新增 Skill、references 与 eval 定义，更新 bundled Skill 白名单和 package assertions。
2. 增加可选 server capability 与客户端 gate。
3. 增加 Project Settings card、draft 准备 helper、国际化和针对性测试。
4. 更新 Skills/worktree 用户文档。
5. 运行 Skill eval、相关单测/E2E、package smoke、Web export、typecheck、lint、format，并独立复核。

### 怎么确认做对

- 多技术栈 eval 中，with-Skill 输出均有证据链、主动发现真实缺口且避免无关脚手架；baseline 对照可见增益。
- Project Settings 从配置缺失和已有配置两种状态进入正确的预填 draft；Host/project/cwd 不漂移；用户原 New Workspace 草稿不被覆盖。
- 未安装、drift、安装失败、旧 Host 状态都有可恢复 UI。
- daemon 和 npm tarball 包含第六个 bundled Skill，现有非托管目录保护不退化。

- Skill eval iteration 3 从当前 fixture 重新冻结：8 个场景、with-Skill/baseline 各 1 次；16 个输入仓库均由 manifest/hash 证明同源，report-only 场景零 diff，apply 场景仅改精确批准文件。独立 grader 逐条评为 with-Skill 51/51（100%）、baseline 35/51（68.6%），绝对增益 31.4 个百分点；单样本、未测方差，不宣称稳定性区间。
- 六类 source fixture 均在隔离副本执行通过：两组 `npm ci` + typecheck、`uv sync --locked` + pytest、`cargo test --locked`、两组 `go test ./...`；apply eval 的最终 JSON/Go diff 另做程序化结构校验。
- `packages/server/src/server/orchestration-skills.test.ts`：9 passed；覆盖第六个 Skill、managed install/update/uninstall、隔离测试安装目录，以及 runtime copy/hash 排除 `.git`、`.pi-subagents`、`.venv`、`evals`、`node_modules`、`target`。
- `packages/protocol/src/generated-validation.test.ts`：15 passed；旧 payload 缺少可选 capability 可解析，新 payload 接受 `projectSetupSkill: true`。
- Project Settings Playwright：6 个目标场景通过；包含真实浏览器 + 真实隔离 daemon 的安装/路由/draft success path，以及未安装、drift、安装失败重试、旧 Host 无 fallback 和显式 release barrier 驱动的过期导航竞态。测试 Skill 安装根目录隔离在临时 E2E home。
- `npm run build:web --workspace=@bytetrue/byspace-app` 真实 Web export 通过。
- `npm run smoke:package` 通过；全局安装 tarball 含恰好 6 个 runtime Skills，不含 sibling eval workspace、Skill `evals` 或本地构建产物目录。首次最终 smoke 因 npm install 子进程 120 秒超时失败，未重启服务；原命令重试通过。
- 根 `npm run typecheck`、`npm run lint`、`npm run format:check` 全部通过。
- 最终独立复核结论可交付：Blocker/High/Medium 均为零；Skill 安全边界、现有配置保留、package allowlist、capability gate、真实 E2E 和 benchmark provenance 均通过。

## 执行记录

- 2026-08-05：用户确认从配置生成器扩展为主动的 project-readiness 顾问，并授权按独立 feature 推进；完成现状检索与实现设计。
- 2026-08-05：完成 bundled Skill、0.5.0 capability gate、Project Settings 入口、8 语言文案、用户文档、严格六项 package allowlist 与工程验证。
- 2026-08-05：用户不再进行人工 viewer review，改由独立 agents 复核；废弃输入漂移的旧 benchmark，从当前 fixture 重跑可复现 iteration 3，补齐事实硬门、secret/data/config preservation 边界、真实 daemon E2E、确定性竞态 barrier 和可重算 benchmark artifacts。最终独立复核判定可交付。
- 2026-08-05：用户授权收尾、提交与推送；关闭 issue，并将稳定产品能力和边界毕业回写 project spec。

## 关闭结论

- 判断：目标与约定范围全部达成。Project Settings 保留精确手工编辑，同时提供受 Host capability 与 bundled Skill 状态约束的 Agent-assisted 入口；Skill 只按仓库证据提出最小 project-readiness 建议，确认前不改文件。未扩展到 CI/CD、部署、脚手架选择或自动危险操作。
- 质量证据：跨六类仓库的可复现 eval 满足功能适宜性与信息安全性边界；真实浏览器 + 隔离 daemon E2E 覆盖入口、安装、失败恢复、旧 Host 和竞态；协议、server、package、Web export、typecheck、lint、format 与独立 review 均通过。
- 毕业回写：当前产品能力与稳定兼容/交互边界已写入 `.cs/spec/index.md` 的“项目准备”章节；无需更新 Vision、notes、Agent 指令或 tools。
- 遗留事项：无。Eval 为每配置单样本，结果仅作为当前固定 corpus 的比较证据，不构成统计稳定性承诺。
