# Host-sync 遗留开口

## 结论

- `kind:"rule"` 副本记录目前没有读者：tunnel 列表聚合各 host 的实时 tunnel.list，rule 写入保留着等一个读它的 UI。若决定不展示，必须把写入与 spec/connection.md 里对应句子一起删，不能只删一边。
- 发布门缺口（未解决）：release:push 把整体 CI success 当 verified，不区分必需 job 被 path filter 跳过。见 verification-discipline。

## 依据

- 类型：可重跑证明（账本记录的执行状态）+ 待 owner 决定的设计开口。
- 证据或复核方式：`byissue/archive/v1/epics/2026-11-12-o-host-sync-chain/ledger.md:81`（rule 无读者）、`:95`（跳过 job 事故）；代码 `internal/hostsync/`（HostSyncRecordKindSchema 含 "rule"，packages/protocol/src/messages.ts:1646）；spec 句子在 `byissue/archive/v1/spec/connection.md`（host-sync 节）。
- 适用条件：host-sync epic 主体已于 2026-11-13 全部做完（含三方对抗评审修复），只剩这两个开口。S17 场景是本机双 daemon + 127.0.0.1 隔离端口 relay 测的，不是真实 laptop↔VPS。

## 重访条件

- 决定 tunnel rule 的展示 UI（做或不做都要处理写入与 spec 句子）。
- release:push 验证逻辑修复后，从本文件删除发布门条目。
