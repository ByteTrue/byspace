# 生成物与批量改名的纪律

## 结论

- 生成文件只在它是外部契约时才提交进仓库；提交的生成文件必须配漂移测试（生成器重跑比对）。
- 批量 URL/symlink 改名前先确认改名目标存在；改名脚本本身要在真实目标上验证。
- 在生成 JS 的模板字符串里，要输出字面 backslash-n 必须写 "\\n"；代码里的 String.fromCharCode(10) 可能是刻意躲这层转义，「简化」它会破坏生成文件（症状在 pi e2e 表现为 `Test timed out in 240000ms`）。现存实例：web/src/core/components/markdown/fence/mermaid/source-policy.ts:25,28 与 runtime/html.gen.ts。

## 依据

- 类型：可重跑证明（漂移与转义事故均实际发生）。
- 被否决的相关方案：生成物一律提交或一律不提交（判据是外部契约）；把 fromCharCode 当冗余简化。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/002-generated-artifacts-and-remote-urls.md`、`009-generated-source-escaping-in-template-literals.md`；mermaid 生成器 `web/src/core/components/markdown/fence/mermaid/build-runtime.mjs`。
- 适用条件：提交生成物、写批量改名脚本、改生成器模板时。009 的原始事故点已随 mermaid 重写变化，规则本身仍适用。

## 重访条件

- 生成器改为非模板字符串方案（转义层消失）。
