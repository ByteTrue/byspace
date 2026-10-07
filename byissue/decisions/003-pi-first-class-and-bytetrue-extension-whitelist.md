---
kind: decision
title: "Pi 一等公民与 ByteTrue 扩展白名单"
created: 2026-10-06
superseded-by: ""
---

# Pi 一等公民与 ByteTrue 扩展白名单

**Provider 适配分先后：Pi 是一等公民。** 界面新能力先给 Pi 做适配，Pi 的扩展生态是产品能力的一部分。其余 provider（Claude、Codex、Copilot、OpenCode）维护降级为 best-effort：已接入的通道保持工作、bug 照修，但不为它们开新的 UI 适配。

**扩展适配只认白名单**（owner 自有的六个 pi 扩展）：

- `@bytetrue/pi-subagent`
- `@bytetrue/pi-web-search`
- `@bytetrue/pi-image-gen`
- `@bytetrue/pi-vendor`
- `@bytetrue/pi-background-terminal`
- `@bytetrue/pi-vision`

非白名单扩展保持 generic fallback 现状：不专门适配，不为它预留抽象，也不为它挡改动。

## 背景

讨论见 `../talks/006-pi-subagent-first-class-adaptation.md`。Owner（2026-10-06）：「之后派将会是一等公民，会优先给派做适配。这些以ByteTrue开头的是我自己做的这些扩展，这些扩展也将会是一等公民扩展，我们只按照这些来适配。」「Pi 排第一，其余 provider 维护降级为 best-effort。」「非白名单扩展，就现在这样就好了。现在怎么样就怎么样，我们不特意去搞它。」

首个落地：`../epics/004-o-pi-first-class-and-bytetrue-extensions/spec.md`。
