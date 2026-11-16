---
kind: work
status: complete
current_unit: "已完成：砍到 en + zh-CN，验证全绿"
next_action: "无（未提交，等用户指示）"
must_hold: "保留 i18n 机制与 t() 调用不动；en/zh-CN 词条内容不动（只删语言选项键）；既有测试改动仅限用户已授权的语言集合断言"
proof_gap: ""
---

# 多语言砍到中英两种

## 目标与边界

用户决定（m00001 提出，m00060「都按推荐做」批准）：没有多语言市场计划，9 语言维护成本不值得，砍到 en + zh-CN。三项批准内容：

1. 删 7 个语言资源（ar/es/fr/ja/ko/pt-BR/ru）与相关测试；system 选项保留（zh\* 简体→zh-CN，其余→en）；存量用户持久化的已删语言静默落回 system。
2. 删 README.ja.md / README.ko.md，保留英文与中文 README，更新头部链接与 scripts/docs-links.test.mjs。
3. 现在执行：删除 + 测试 + typecheck/lint + 重写 docs/i18n.md，决定记入 bywork/memory/product-scope.md。

边界：不内联 t() 调用（另一个重构，无收益）；不动 en/zh-CN 的翻译内容，只删两份资源里 settings.general.language.options 下 7 个已删语言的选项键。

## 已定方案与约束

- 语言集合的唯一真相是 web/src/core/i18n/locales.ts（SupportedLocale/LANGUAGE_OPTIONS/名称矩阵/system 映射）与 web/src/core/hooks/use-settings/storage.ts:221 的持久化 enum。i18next.ts 资源注册、settings-screen.tsx 选择器自动随集合收缩，选择器代码不改。
- 存量回退不需要迁移代码：storage.ts 的 z.enum(...).catch("system") 会把已删语言读成 system；wire 侧 language 本来就是宽松 z.string().optional()（packages/protocol/src/messages.ts:3675），协议不受影响。
- 既有测试改动（用户已授权，理由）：locales.test.ts 与 resources.test.ts 断言的就是被砍掉的 9 语言集合本身，语言集合变更后这些断言的对象不复存在；key-contract.test.ts 仅改报错文案「other 8 locales」；scripts/docs-links.test.mjs 的 SCANNED 清单删两条已删 README 条目（fixture 随文件走）。en-only 的 Batch 断言（resources.test.ts:185-621）与其余测试不动。
- 新回归测试放新文件 web/src/core/i18n/language-cut.test.ts，先在旧代码上跑红（证明守卫有效），再实施删除。

## 行为证明

| 行为路径 | 真实入口                                                                  | 操作                           | 应观察到                                                    | 证据 | 结果 |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- | ---- | ---- |
| 新守卫在旧代码上见红     | cd web && npx vitest run src/core/i18n/language-cut.test.ts               | 删除前运行新测试               | 断言 2 语言集合的测试失败                                   | 删除前运行 1 failed (9)，失败在 LANGUAGE_OPTIONS 断言（旧 9 语言集合），m00178 | 通过 |
| 存量用户语言设置安全回退 | web/src/core/i18n/language-cut.test.ts（loadAppSettingsFromStorage 入口） | 持久化 ja 等已删语言后加载设置 | 读回 system，其余设置保留                                   | 砍后全绿：it.each 7 已删语言均读回 system 且 theme=dark 保留（135 测试之一部分） | 通过 |
| system 跟随与显式选择    | web/src/core/i18n/locales.test.ts                                         | 跑改写后的映射测试             | zh/zh-CN/zh-Hans\*→zh-CN，zh-TW/其他→en，显式 en/zh-CN 优先 | locales.test.ts 全绿（含 ja-JP→en、de-DE→en、[]→en） | 通过 |
| 中英词条保持成对         | web/src/core/i18n/resources.test.ts + key-contract.test.ts                | 跑改写后的 parity 测试         | en/zh-CN 键集一致、插值占位一致、t() 字面量全部有键         | cd web && npx vitest run src/core/i18n/ src/core/hooks/use-settings/storage.test.ts --bail=1 → 7 files 135 tests 全过 | 通过 |
| README 链接可达          | node --test scripts/docs-links.test.mjs                                   | 删两份 README 后跑链接守卫     | 0 broken                                                    | 2 pass 0 fail（含 public-docs 链接检查） | 通过 |
| 仓库检查绿               | npm run typecheck; npm run lint; npm run format:check                     | 改动后运行                     | 全部通过                                                    | typecheck 无 error；lint 0 warnings 0 errors（2134 文件）；format 后 format:check 全过 | 通过 |
| work 校验                | python3 ~/.agents/skills/bi/scripts/check_work.py --project .             | 完成前运行                     | 本 work ok                                                  | check_work 输出 ok（见下方证据） | 通过 |

## 证据与决定

- 净改动：22 个已跟踪文件 +29/-19583 行，另新增 language-cut.test.ts 与本 work。删 7 份语言资源（各约 2700 行）与 README.ja/ko；locales.ts 207→77 行（删 9×9 名称矩阵与区域映射表）；storage enum 缩为 ["system","en","zh-CN"]。
- i18next 只静态打包 en/zh-CN，web bundle 少约 700KB 源码的词条。
- docs/i18n.md 重写：2 语言集合与新 system 映射、决策指针指向 bywork/memory/product-scope.md；删掉已完成的 Batch 迁移进度日志；保留 Translation Scope / Adding Copy / Forge-Variant Copy 规则；parity 测试命令修正为 cd web 下运行（根配置不含 web）。
- 产品范围记录：bywork/memory/product-scope.md 不做列表新增「中英以外的界面语言」，依据类型：用户决定，重访条件沿用 owner 明确推翻。
- 全仓引用扫描无残留：已删资源导入与 README.ja/ko 链接只剩 byissue 历史记录（不参与链接守卫）；选择器 UI（settings-screen.tsx）随 LANGUAGE_OPTIONS 自动收缩，零改动。
- 未提交、未推送（未获指示）。