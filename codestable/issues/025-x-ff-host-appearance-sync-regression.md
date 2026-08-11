---
kind: issue
title: "恢复 Host 外观设置"
type: ff
status: closed
created: 2026-08-10
---

# 恢复 Host 外观设置

## 做了什么

修复 BySpace 移植 Host Appearance 时留下的回归：颜色选项重新与真实身份色枚举对齐，恢复色块、Host 名称编辑入口和 Workspace Badge 预览，并补齐可访问名称。

## 改了哪些

- `packages/app/src/screens/settings/host-page.tsx` — 恢复上游 Appearance 卡片的名称、颜色色块、真实侧边栏 Meta Row 预览与可访问标签。
- `packages/app/src/i18n/resources/{ar,en,es,fr,ja,pt-BR,ru,zh-CN}.ts` — 统一实际颜色枚举、Badge 和预览词条；修正中文文案。
- `packages/app/src/i18n/resources.test.ts` — 锁定颜色与 Badge 选项必须和运行时枚举一致，并复用现有全语言键一致性检查。

## 怎么验证的

`resources.test.ts` 31/31、`npm run typecheck`、`npm run lint`、`npm --workspace @bytetrue/byspace-app run build:web` 全绿；独立 6768 daemon 浏览器实测英文/中文全量颜色菜单、色块、持久化和 Badge 预览，Console 0 error。

## 对 `codestable/` 的影响

无已记录真相受影响：这是既有 Host 身份外观能力的同步回归修复，不改变持久化、默认值或侧边栏 Badge 语义。
