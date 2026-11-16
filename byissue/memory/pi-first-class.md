# Pi 一等公民与扩展白名单

## 结论

- Provider 适配分先后：Pi 是一等公民，界面新能力先给 Pi 做适配；Pi 的扩展生态是产品能力的一部分。
- 其余 provider（Claude、Codex、Copilot、OpenCode）维护降级为 best-effort：已接入的通道保持工作、bug 照修，不为它们开新的 UI 适配。
- 扩展适配只认 owner 自有的六个白名单扩展：`@bytetrue/pi-subagent`、`@bytetrue/pi-web-search`、`@bytetrue/pi-image-gen`、`@bytetrue/pi-vendor`、`@bytetrue/pi-background-terminal`、`@bytetrue/pi-vision`。
- 非白名单扩展保持 generic fallback 现状：不专门适配，不为它预留抽象，也不为它挡改动。

## 依据

- 类型：用户决定。Owner（2026-10-06）原话：「之后派将会是一等公民，会优先给派做适配。这些以ByteTrue开头的是我自己做的这些扩展，这些扩展也将会是一等公民扩展，我们只按照这些来适配。」「Pi 排第一，其余 provider 维护降级为 best-effort。」「非白名单扩展，就现在这样就好了。现在怎么样就怎么样，我们不特意去搞它。」
- 被否决的相关方案：为所有 provider 平等做新 UI 适配（维护面过大）；为非白名单扩展预留抽象（owner 明确不特意搞）。
- 证据或复核方式：`byissue/archive/v1/decisions/003-pi-first-class-and-bytetrue-extension-whitelist.md`；讨论背景 `byissue/archive/v1/talks/006-pi-subagent-first-class-adaptation.md`；首个落地 `byissue/archive/v1/epics/004-x-pi-first-class-and-bytetrue-extensions/spec.md`。
- 适用条件：决定于 2026-10-06，此后未被推翻。白名单扩展的实际包名以 `@bytetrue/` 前缀为准（归档笔记中部分简写无前缀）。

## 重访条件

- owner 调整 provider 优先级或增删白名单扩展。
- 某个 best-effort provider 的既有通道坏到影响日常使用（修 bug 仍属 best-effort 范围，开新适配需要新决定）。
