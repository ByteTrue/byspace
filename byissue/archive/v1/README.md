# v1 归档

bi 工作流 v1 的全部过程产物，2026-11-16 整体冻结迁入。v2 的产物在 `byissue/work/`、`byissue/memory/`、`byissue/vision/`；v2 可引用这里做溯源，这里不反向引用 v2，也不随 v2 工作改动。

## 这里有什么

| 目录       | 内容                                      | 数量 |
| ---------- | ----------------------------------------- | ---- |
| decisions/ | v1 决策记录（8 篇，含 superseded 链）     | 8    |
| epics/     | Epic 规格与执行账本（12 个 epic）         | 55   |
| issues/    | Issue 记录与 node-reaudit-log.md 重审账本 | 176  |
| notes/     | 踩坑与外部事实笔记                        | 44   |
| spec/      | v1 产品行为规格（7 个主题 + index）       | 8    |
| talks/     | 方向讨论记录                              | 11   |

## 怎么读

- 文件是冻结记录：内容不改写，内部相对链接原样保留（整块移动，链接仍互通）。
- 仍然成立的跨任务判断已蒸馏进 `byissue/memory/`，每篇 memory 的「依据」注明来源文件。日常判断读 memory；需要完整论证、owner 原话、执行时间线时再回到这里。
- spec/ 是 v1 的产品真相快照，不是当前真相。当前行为以代码与 docs/ 为准；spec 里的行为描述可能已过时（例如 MCP 交付已于 2026-11-09 退役）。
- vision/index.md 没有归档：它留在 `byissue/vision/`，按 v2 模板重写。

## 仍被外部引用的文件

活脚本与代码注释指向这里的固定路径，移动这些文件会破坏守卫：

- `issues/node-reaudit-log.md` — scripts/reaudit-ledger-check.mjs 运行时读取（npm run audit:ledger）。
- `issues/2026-11-09-x-retire-mcp-tools-for-skill-cli.md` — scripts/parity-surface.mjs 的退役清单标签引用。
- `epics/2026-11-12-o-host-sync-chain/spec.md` — internal/hostsync/document.go 与 packages/protocol/src/messages.ts 注释引用。
- `epics/2026-10-31-o-ui-style-refresh/` — design/references/shadcn/README.md 引用为唯一组件参照来源。
- `notes/2026-11-12-cli-pair-offline-offer-boots-the-home.md`、`notes/2026-11-13-ts-relay-client-never-answered-the-e2ee-challenge.md`、`notes/017-go-process-termination-needs-the-group.md`、`spec/connection.md`、`spec/terminal.md` — docs/ 多篇文档链接引用（scripts/docs-links.test.mjs 守卫校验）。
- `issues/042-x-paseo-identity-migration.md` — docs/glossary.md 与 docs/protocol-compatibility.md 正文引用。
- `issues/2026-10-30-x-ff-agcopilot-framed-card-window-shell.md` — web/src/app/desktop-window-titlebar.tsx 注释引用。
