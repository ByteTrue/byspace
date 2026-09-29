---
kind: issue
title: 内置名单：八角色+mika 应开机即在（Owner：agents 只有 5 个不对）
type: feature
status: closed
created: 2026-09-29
---

# 内置名单：八角色+mika 应开机即在（Owner：agents 只有 5 个不对）

> **读者：** 接手的人——040 只把角色做成 create 时的可选种子；Owner 的预期是名单本身开机就有九位（八角色+mika）。

## 现象

agents 页 5 张卡：4 个验证探针 + Chief of Staff。八角色只在 create 表单的 role 下拉里存在，不点不出现。Owner："正确的应该是从 qoderwake 提取的 8 个加 multica 提取的 1 个 mika"。

## 源语义校准

- 内置名单行是**可分派队友**（kind=user）：秘书按名字派活，role 必须在 assignee 选择面里；只有 mika 是 system（隐藏载体）。
- agents 默认面**藏 archived**（源 agents-page：archived 行离开名单直到有人开 archived scope）；我们 includeArchived 是为恢复入口拉的，默认面却不过滤——探针因此和队友混排。

## 收法

- 启动 seed（seedBuiltinRoster，与秘书 seed 同纪律）：按 system_key 幂等建八行 kind=user 队友，instructions=三角色文件，技能播种+链接到该行；失败响亮不致命。
- agents 默认面过滤 archived（计数同源）；恢复入口在详情页（008 已有）。
- CLI 补 archive/restore 动词（清理探针、脚本化退役的面）。

## 执行记录

- 真机：重启后 9 行（8 队友+mika）各带 5k–44k instructions 与链接技能；4 探针 CLI archive 后默认面 8（CLI 源语义藏 system）/控制台 9（includeSystem）；探针不在默认面、可在详情恢复。
- seed 测 2/2（一次播齐带声带技；二次零新建且不改控制台改过的 instructions）。
