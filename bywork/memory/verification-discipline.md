# 验证纪律：绿不等于可交付

## 结论

- knip/grep 报「unused」只是线索：先验证非静态调用通道（RPC 名、动态 import、配置引用）再删。等价性必须在仓库 pin 的运行时上测。本地绿不等于可交付：只有 `npm ci` 会暴露依赖漂移。
- 把无关前置条件与被测行为分开：audit 浏览器验证曾因环境问题从 10/10 掉到 2/4，修好前置后 7/8，掉的不是被测行为。
- 发布门必须区分「必需 job 真的跑了」与「被 path filter 跳过但整体绿」：0.25.0 tag 建在 docs/scripts-only commit 上，CI 跳过 go/app/browser/relay job，release:push 把整体 success 当 verified；补跑全量 tag CI 后 setup-guide-pairing 与 sidebar-workspace-mark-unread 仍失败。
- 汇总器只数失败标记（如 `--- FAIL:`）时，空输出 = 假全绿；先确认子进程有输出。

## 依据

- 类型：可重跑证明（各误判均有事故记录）。
- 被否决的相关方案：静态 unused 报告直接当删除依据；整体 CI success 当发布验证；空输出当通过。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/001-dead-code-audit-criteria-and-traps.md`、`016-verification-tools-report-false-failures.md`、`2026-11-04-windows-url-pathname-is-not-a-disk-path.md`（audit 汇总假绿）；账本 `bywork/archive/v1/epics/2026-11-12-o-host-sync-chain/ledger.md:95`（跳过 job 事故）。
- 适用条件：删除代码、发布、解读任何守卫/CI 结果时。

## 重访条件

- CI path filter 或 release:push 的验证逻辑变更（检查是否已区分 skipped 与 ran）。
