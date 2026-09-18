---
kind: issue
title: "自托管 config schema，去掉对上游 URL 的依赖"
type: chore
status: closed
created: 2026-09-18
closed: 2026-09-18
---

# 自托管 config schema，去掉对上游 URL 的依赖

> **读者：** 跨会话接手的人——「为什么那份 schema 不能继续指上游、为什么放 Cloudflare Pages 而不是 daemon、生成物怎么保持不漂移」。
> **目标：** `~/.byspace/config.json` 的编辑器补全由我们自己托管，URL 指向自己的域名，内容由 zod 定义生成。
> **别碰：** `PersistedConfigSchema` 本身；`$schema` 字段的解析行为。
> **验证：** `curl` 新 URL 返回 `application/json`；生成物字段与 zod 定义一致；`docs-links` 测试通过。

---

## 做成以后是什么样

`public-docs/{configuration,connectivity,mcp}.md` 里的 `$schema` 指向 `https://app.byspace.cc.cd/schemas/byspace.config.v1.json`，该 URL 返回一份由 `PersistedConfigSchema` 生成、随构建更新的 JSON Schema。仓库里不再有指向 `paseo.sh` 的 schema 引用。

**范围：** 生成脚本 + 构建接线 + 3 处 URL。
**不包含：** daemon 侧的 `/schemas` 路由（见「为什么不做」）；`$schema` 字段的运行时行为（daemon 一直忽略它）。
**归属：** 根 `issues/`。是 [042](042-o-paseo-identity-migration.md) 的执行中发现物：042 的批量改名把 3 处 URL 改成了不存在的 `byspace.config.v1.json`（404），回退到上游 URL 后又暴露出「我们其实在指别人的产品」这个更根本的问题。

## 为什么现在做

042 执行中，批量替换把 `paseo.sh/schemas/paseo.config.v1.json` 改成了 `byspace.config.v1.json`——**404**。改回上游 URL 后核对内容，发现两件事：

**1. 上游那份描述的不是我们的产品。** 上游 schema 顶层有 `features.webUi`，而我们有 `terminalProfiles`、`skills`、`browserTools`、`terminalDefaultShell` 等它没有的字段。它是 Paseo 的 config，不是 BySpace 的。

**2. 我们已经能自己生成。** `PersistedConfigSchema`（`packages/server/src/server/persisted-config.ts:235`）是磁盘 `config.json` 的真实形状。用 zod 4.4.3 的 `z.toJSONSchema` 生成后与上游对比：**我们是严格超集**——9 个顶层字段完全一致（`$schema`、`version`、`daemon`、`app`、`agents`、`features`、`log`、`providers`、`worktrees`），只多 `plugins`、`pluginsEnabled`。生成物 8971 字节。

所以「指上游」不是权宜，是错的：它给用户补全的是另一个产品的字段。

## 现状怎么工作

- `~/.byspace/config.json` 的形状由 `PersistedConfigSchema` 定义，`version: z.literal(1).optional()`。
- `$schema` 是**给编辑器用的**：daemon 在算 restart-required 路径时显式跳过它（`daemon-config-store.ts:677`：`if (path === "$schema" || path === "version") return false;`）。
- 因此这份 JSON 从未被 daemon 校验或读取，**托管它的唯一目的是让编辑器有补全**。
- 上游用同一个域名托管它：`paseo.sh/schemas/paseo.config.v1.json`（HTTP 200，17KB）。

## 方案

### 生成脚本已经存在（只需改输出路径）

`packages/server/scripts/generate-config-schema.ts`（挂在 `server` 的 `generate:config-schema`）已经在做这件事：用 `z.toJSONSchema(PersistedConfigSchema, { target: "draft-07", unrepresentable: "any", io: "input" })` 生成，并设 `title = "BySpaceConfigV1"`。

**它失效的唯一原因：输出路径是 `packages/website/public/schemas/`——营销站目录已在 issue 025 退役。** 且它从未被任何构建链接线（只能手动跑）。

所以本 Issue 的实际改动：

1. **改输出路径** 到 `packages/app/public/schemas/byspace.config.v1.json`。
2. **接进构建**：挂在 app 的 `build:web` 之前，保证产物与 `PersistedConfigSchema` 同步。
3. **改 3 处文档 URL**。

不新建脚本——已有的逻辑是对的。

### 托管

`packages/app/public/` 下的内容会随 `expo export` 进 `dist/`，再随 `wrangler pages deploy` 上线到 Cloudflare Pages。

**已验证**：Cloudflare Pages 的静态文件优先级高于 SPA 兜底——`app.byspace.cc.cd/robots.txt` 返回 `text/plain`，只有不存在的路径才回退 `index.html`（`/schemas/__nonexistent__.json` 返回 `text/html`）。所以 `/schemas/*.json` 能正常返回 JSON。

### 改 3 处 URL

`public-docs/configuration.md:40,252`、`public-docs/connectivity.md:93`、`public-docs/mcp.md:29` 从 `https://paseo.sh/schemas/paseo.config.v1.json` 改为 `https://app.byspace.cc.cd/schemas/byspace.config.v1.json`。

## 为什么不做 daemon 路由

daemon 已经托管 web UI（`packages/server/src/server/web-ui.ts`），加 `GET /schemas/*` 技术上容易，且能让自托管用户（`docs/docker.md` 场景）不依赖公网拿到 schema。**但本轮不做**：那是一块新的 daemon 代码面与测试面，而当前唯一需求是「文档里的示例 URL 不是 404 且不是别人的产品」。真出现离线自托管需求再加。

## 命名

用 `byspace.config.v1.json`，与 schema 内的 `version: z.literal(1)` 呼应，也与上游的 `paseo.config.v1.json` 形状一致。

## 动哪些、验哪些

- 必须改：`packages/server/scripts/generate-config-schema.ts` 的输出路径；`packages/app/package.json` 的构建链；`packages/app/public/schemas/byspace.config.v1.json`（生成物）；3 处文档 URL。
- 需要验：生成物字段数（顶层 11、`daemon` 18）；`curl` 部署后的 URL 返回 `application/json`；`node --test scripts/docs-links.test.mjs`；`npm run build:web` 后产物含该文件。
- 仍未知：Cloudflare Pages 对深层路径 JSON 的 cache header（不影响功能，可在上线后看一眼）。

## 验证

- 生成物与 `PersistedConfigSchema` 一致：改一个 zod 字段 → 重新生成 → 产物跟随（这条用来证明没有手改漂移）。
- 部署后 `curl -sS -o /dev/null -w '%{http_code} %{content_type}' https://app.byspace.cc.cd/schemas/byspace.config.v1.json` 应为 `200 application/json`。
- 该 URL 上线前不可验，**是本 Issue 唯一需要部署后才能确认的一项**。

## 风险

- **`unrepresentable: "any"` 会让 `z.unknown()` 字段在 schema 里变成无约束**。这是可接受的：编辑器补全不需要那些字段的精确形状，而收紧它们会让生成失败。
- **生成物进 git**：这是一份**对外发布的契约**（定义用户能在 config.json 里写什么），改动应可在 review 中看到，因此选择提交而不是忽略。代价是手改风险，用一条 drift 测试兜住：重新生成并与已提交文件比对。
  （对照：`packages/protocol/src/generated/validation/*.aot.ts` 是 gitignore + prebuild 重生成。那类生成物是内部实现，无人 review；本文件性质不同。）
- **Cloudflare Pages 的 SPA 兜底**：已实测静态文件优先，但若将来加 `_redirects` 规则，需重验。

## 执行记录

**2026-09-18 完成。**

### 意外发现：脚本已存在，只是写向已退役的目录

侦察时发现 `packages/server/scripts/generate-config-schema.ts` 本来就在，且挂在了 `server` 的 `generate:config-schema` 上。**它失效的唯一原因是输出路径写着 `packages/website/public/schemas/`——营销站已在 issue 025 退役。** 且它从未被任何构建链接线，只能手动跑。

所以实际改动比原计划小：没有新建脚本，只改了输出路径。

### 改动

1. `generate-config-schema.ts`：输出路径改为 `packages/app/public/schemas/byspace.config.v1.json`。
2. 根 `package.json`：新增 `build:config-schema`（转发到 server 的 `generate:config-schema`）。
3. `packages/app/package.json`：`build:web` 在 `expo export` 前串上 `build:config-schema`。
4. 4 处 URL 改为 `https://app.byspace.cc.cd/schemas/byspace.config.v1.json`：`public-docs/{configuration,connectivity,mcp}.md`（共 4 行）+ `persisted-config.test.ts:683` 的 fixture。
5. 新增 drift 测试 `packages/server/scripts/config-schema-drift.test.ts`。
6. `.oxfmtrc.json` 的 `ignorePatterns` 加 `packages/app/public/schemas/*.json`——**这是必需的，不是顺手**：drift 测试做逐字节比对，而 oxfmt 会把 `JSON.stringify(…, 2)` 输出的短数组压成一行，于是每次 `npm run format` 都会把文件改成与生成器不一致，两个门禁互相打架。已实测：加上 ignore 后跑 `npm run format`，文件 hash 不变且 drift 测试通过。
7. 修一处**042 引入的真 bug**：批量替换把 CI 里的 `@getpaseo:registry=` 改成了 `@getbyspace:registry=`（通用规则 `paseo`→`byspace` 作用在 `getpaseo` 内部），而真实 scope 是 `@byspace`。这让「内部 workspace 不可从 registry 拉取」的检查屏蔽了一个不存在的 scope，等于失效。已修 `.github/workflows/{ci,npm-release}.yml` 3 处 + `scripts/ci-workflow.test.mjs` 2 处断言。

### 超出计划的一项收益

原计划判断 daemon 侧 `/schemas` 路由「本轮不做」。实际**免费得到了**：`scripts/build-daemon-web-ui.mjs` 复用 app 的 `build:web`，所以 `build:daemon-web-ui` 会把 schema 一并拷进 `dist/server/web-ui/schemas/`，并预压缩为 `.br`/`.gz`。

已在真实 daemon 上实测（`BYSPACE_HOME=/tmp/...`，端口 6801）：

```
GET /schemas/byspace.config.v1.json -> 200, application/json; charset=utf-8, 22288 bytes
GET /schemas/__nonexistent__.json   -> 200, text/html（SPA 兜底，符合预期）
```

所以自托管/离线用户不依赖公网也能拿到 schema。daemon 的 `web-ui.ts:74` 先找文件、找不到才回退 `index.html`，因此 JSON 不会被 SPA 吞掉。

### 验证

- **漂移防护已实测有效**：注入一个手改字段 → drift 测试失败；`build:config-schema` 重新生成 → 测试恢复通过。
- **zod → 生成物同步已实测**：临时在 `PersistedConfigSchema` 加哨兵字段 → 重新生成后产物跟随；已还原。
- **完整构建链已实测**：从空目录执行 `npm run build:web --workspace=@byspace/app`，自动生成 schema 并进入 `dist/schemas/`。
- 生成物：顶层 11 字段、`daemon` 18 字段、`title: BySpaceConfigV1`、`additionalProperties: false`（已核实与运行时 strict 行为一致：未知顶层与未知 daemon 字段均被 zod 拒绝）。
- `typecheck` 0 错误；`lint` 0 warn/0 error；`format:check` 全绿；`docs-links` 2/2 通过；`persisted-config.test.ts` 44 通过。

### 未完成（需部署后确认）

**公网 URL 的 200 / `application/json` 无法在本地验证**——它是本 Issue 唯一需要部署后才能确认的一项是。部署后跑：

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://app.byspace.cc.cd/schemas/byspace.config.v1.json
```

预期 `200 application/json`。本地已验证等价逻辑：Cloudflare Pages 静态文件优先于 SPA 兜底（`robots.txt` 返回 `text/plain`），且 expo 导出产物确实含该文件。

## 关闭时

**关闭结论（2026-09-18，交付关闭）：**

- **为何可关：** 目标达成——schema 由 `PersistedConfigSchema` 生成、随 `build:web` 上产到 Cloudflare Pages 与 daemon 内置 web UI，4 处 URL 已指向自己的域名，仓库内不再有指向 `paseo.sh` 的 schema 引用。漂移防护（drift 测试）与生成同步均已实测。
- **验证摘要：** 见「执行记录·验证」。唯一未验项是公网 URL 的响应（需部署，已作为待办写入）。
- **回写到 project spec 的候选：** 无——不改变用户可依赖的产品行为；schema 只影响编辑器补全。
- **回写到 notes 的候选：** 已立 [`byissue/notes/002`](../notes/002-generated-artifacts-and-remote-urls.md)（生成物的提交/忽略判据，以及外部 URL 改名需要实测的教训）。
- **遗留：**
  - 公网 URL 需部署后 curl 确认（见「未完成」节）。
  - daemon 侧 `/schemas` 路由已**免费获得**（`build-daemon-web-ui` 复用 `build:web`），无需单独实现。
  - `packages/server/scripts/generate-config-schema.ts` 的 `title` 是硬编码字符串，未随 schema 名派生——可接受，但若将来加第二份 schema 需重构。
