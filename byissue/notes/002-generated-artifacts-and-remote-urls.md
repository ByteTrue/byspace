# 生成物的提交判据，以及外部 URL 与符号链接的改名陷阱

> **读者：** 要提交或重新生成一个生成文件、或要批量改名仓库里的字符串的人。
> **自检：** 一句话结论 · 何时用 · 细节/坑 · 相关 issue/代码位置。

---

**结论三条：**

1. **生成物进 git 还是 gitignore，判据是「它是不是对外契约」。** 对外契约必须提交（可 review 的 diff 是它的价值），内部实现应忽略并在 prebuild 重新生成。
2. **提交了的生成物必须有 drift 测试**，否则手改会静默覆盖定义。
3. **批量改名外部 URL 与符号链接前，先实测目标是否存在。** 改名会制造 404 和假链接，而本地测试通常覆盖不到。

**何时用：** 新增生成文件时；用脚本批量替换跨文件字符串时。

## 生成物的提交判据

仓库里目前两种做法并存，不是不一致，是两类东西：

| 生成物                                                | 处理                                                                                         | 为什么                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/protocol/src/generated/validation/*.aot.ts` | gitignore + `prebuild`/`pretypecheck`/`pretest` 重新生成（`packages/protocol/package.json`） | 内部实现，无人 review，产物巨大                                                                |
| `packages/app/public/schemas/byspace.config.v1.json`  | 提交，配 drift 测试                                                                          | **对外发布的契约**——定义用户能在 `~/.byspace/config.json` 里写什么，字段增减应出现在 review 里 |

判据：**如果用户或第三方会依赖它的内容，就提交；如果只是构建中间物，就忽略。** 提交的那类，diff 本身就是文档。

## 提交了的生成物必须配 drift 测试

提交 = 允许手改 = 会漂移。防护方式：测试里重新生成一份，与已提交文件逐字节比对。

先例：`packages/server/scripts/config-schema-drift.test.ts`。

```ts
function generate(): string {
  const schema = z.toJSONSchema(PersistedConfigSchema, {
    target: "draft-07",
    unrepresentable: "any", // 必需：schema 含 z.unknown()，不带此选项会抛错
    io: "input",
  });
  schema.title = "BySpaceConfigV1";
  return `${JSON.stringify(schema, null, 2)}\n`;
}

test("matches the committed file", () => {
  expect(readFileSync(schemaPath, "utf8")).toBe(generate());
});
```

**漂移测试要证明它真的会失败**——注入一个手改字段，确认测试红，再重新生成确认绿。没验证过会失败的漂移测试等于没有。

## 外部 URL 的改名陷阱

**2026-09 的全仓 `paseo` → `byspace` 改名踩到三次，全部是同一类错误：改了字符串，没验证目标。**

**1. `$schema` URL 被改成不存在的地址。** `paseo.sh/schemas/paseo.config.v1.json` 被替换为 `byspace.config.v1.json`，后者 404。**教训：外部 URL 是引用，不是品牌。** 改域名前先 `curl` 目标是否存在；存在则先想清该不该改（这里的正解不是改 URL，是自己托管一份——见 [`044-x`](../issues/044-x-self-hosted-config-schema.md)）。

**2. 第三方产品的真名被改，链接 404。** `hinnes.paseo-vscode`、`gpambrozio/paseo-menubar` 这类是**别人发布的产品**，`paseo` 是他们的商标。改名后 URL 失效。**这类字符串必须放进保护清单，与 `getpaseo/paseo` 等上游引用同级。**

**3. 符号链接被替换成实体文件。** `AGENTS.md` 原本是指向 `CLAUDE.md` 的符号链接（`git ls-files -s` 显示 mode `120000`），被 `perl -i` 写成了普通文件。**教训：批量替换前用 `git ls-files -s` 检查 mode，或直接排除符号链接。**

### 实践建议

批量替换脚本要维护三类清单：

- **保护清单**：外部 URL、第三方产品名、上游引用（`getpaseo/paseo`、`paseo.sh`）——不改。
- **改后必查清单**：凡是引用外部资源的目标（URL、路径），逐个 `curl`/`ls` 确认可达。
- **结构清单**：符号链接、子模块、`.gitignore` 覆盖的生成物——不进替换。

替换后跑一次 `git status --short` 看 mode 变化（`T` = typechange），能一次抓出符号链接被写坏的情况。

## 相关位置

- 生成脚本：`packages/server/scripts/generate-config-schema.ts`
- 漂移测试：`packages/server/scripts/config-schema-drift.test.ts`
- 静态文件与 SPA 兜底的优先级：Cloudflare Pages 上实测（`robots.txt` 返回 `text/plain`，不存在的路径才回退 HTML）；daemon 侧同理，见 `packages/server/src/server/web-ui.ts:74`（先找文件，找不到才 `index.html`）。
