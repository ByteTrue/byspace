# Go 单二进制：行为翻译纪律与缺陷分类

## 结论

- 后端 / CLI / relay 全部进一个零 CGO Go 二进制（`CGO_ENABLED=0` 必须能编译）；前端是编译产物嵌入。协议 schema 与 nacl/box↔tweetnacl 字节兼容不变；`$BYSPACE_HOME` JSON 格式不变。
- magpie 只给形状（架构参考），不给行为：行为从 Node 版本逐行翻译，不重新发明。
- 五类缺陷与检测手段：字段没接/没发 → 静态对账（`npm run audit` 入站/出站）；字段发了值假 → 逐文件读；时序/锁错 → 真实运行 + 协议 trace；分支写了无生产端 → grep 符号确认非测试引用；实现存在没人调用 → 按 Node 调用者反查 Go 调用点。后三类的共同点：代码对、类型对、测试绿，但从未被执行。
- 新增 provider/事件路径必须回答「最坏时序下会不会持锁做慢操作」：handleRawEvent 持锁处理整轮，读循环被阻塞 = agent 无响应。
- 新增错误类型/格式化器/分支必须确认生产端真的会发出它：grep 只有定义点 = 死代码。

## 依据

- 类型：用户决定（2026-10-19 架构拍板）+ 可重跑证明（六次自发明陷阱都是 owner 真实使用中抓到的）。
- 六次自发明陷阱（正确行为以 Node 为准）：timeline 落盘快照（Node 是纯内存 + provider 重建）；process_exit 发 turn_completed 保留 runtime（应为 turn_failed + closeAgent）；steer 无条件下发（应先查活跃轮次，否则 inactive 开新轮）；pairing QR 用 SHA-256 伪矩阵（应为 qrcode 真 QR）；skills status 硬编码 up-to-date（应为三态 + 逐 op targets）；ACP 预设当常驻内置（应为 6 内置 + Add provider 按需）。
- 被否决的相关方案：参考 magpie 的行为实现（形状可借，行为必须翻译）；「测试绿即完成」（后三类缺陷测试全绿仍存在）。
- 证据或复核方式：`byissue/archive/v1/decisions/004-go-single-binary-architecture.md`；对账守卫 `scripts/go-parity-audit.mjs`、`scripts/go-emit-parity.mjs`、`scripts/reaudit-ledger-check.mjs`（`npm run audit`）；锁守卫 `internal/server/lock_hygiene_test.go`（同类锁 bug 复发 3 次后加的 AST 检查）。
- 适用条件：Go daemon 的所有行为改动。Node 原版已删（commit 20721fdcf），行为基准现在是对账快照 `scripts/node-surface-snapshot.json` 与归档账本 `byissue/archive/v1/issues/node-reaudit-log.md`。

## 重访条件

- 引入 CGO 依赖或第二个二进制。
- 对账守卫报出新的 gap 类别（说明缺陷分类需要扩充）。
