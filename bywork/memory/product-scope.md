# 产品范围：已决定不做与准入判据

## 结论

- 已决定不做的方向：RN native、Electron、iOS 壳、应用商店、npm 分发、SSH、Hub、插件系统、中英以外的界面语言（2026-11-17 砍掉 ar/es/fr/ja/ko/pt-BR/ru 七种，i18n 机制保留，见 docs/i18n.md）、provider 余额/用量报表（2026-11-18 砍掉 quota 整链）、版本漂移兼容层（见下条）。
- 不做版本漂移兼容（2026-11-18 瘦身批次一，owner 拍板「COMPAT 一个都不应该留」）：app 与 daemon 同 commit 同版本部署，无新旧混跑需求。协议可直接删字段/窄化/改 required，无需 COMPAT 标签与 features 版本门。features 只保留 runtime-state 门（webPush/daemonServiceInstall/daemonTunnels）与 catalog（agentRoleNames）。schema 纯度规则（无 transform/catch/preprocess）仍保留。详见 docs/protocol-compatibility.md。
- 能力准入判据（ADE scope）：一个能力属于 BySpace，当且仅当它不替代用户本来就会调用的东西；工作流住在用户自己的 agent 配置里，daemon 不持有工作流。
- 远程访问走 E2EE relay，不做 P2P（owner 网络环境下打洞从未成功，明确否决）；不依赖 Tailscale/VPN/端口转发。
- Paseo 上游基线冻结在 v0.8.0（2026-09-11），不追上游，只作参考；身份迁移已把 wire 名全部改为 BySpace，无 shim（docs/protocol-compatibility.md）。Paseo 名字只保留三处：README fork 声明、LICENSE 上游版权行、CHANGELOG 上游 PR 链接。
- orca MIT 吸收已放弃（Epic 003，owner 2026-10-14 决定 dropped）：原则是借交互不借架构、UI 用 BySpace 设计系统重做，但整个吸收工作停止。
- 终端内容是唯一真相；hook 活动状态是 best-effort 提示，永不把用户锁在错误状态里。

## 依据

- 类型：用户决定（不做列表、P2P 否决、orca 放弃、语言砍到中英、quota 砍除、无版本漂移政策均为 owner 拍板）。
- 被否决的相关方案：P2P 打洞；追 Paseo 上游；orca 架构吸收；VelaTerm 式反例（同一事物两套实现 + 两处无人认领的悬挂）。
- 证据或复核方式：`bywork/archive/v1/spec/index.md`（不做列表）、`bywork/archive/v1/notes/005-ade-scope-criteria.md`、`008-tunnel-performance-and-relay-vs-p2p.md`、`bywork/archive/v1/vision` 前身（现 bywork/vision/index.md）、`bywork/archive/v1/epics/003-d-orca-*`（dropped）、`bywork/archive/v1/issues/042-x-paseo-identity-migration.md`、`bywork/work/i18n-two-locales/index.md`（语言砍减）。
- 适用条件：新能力立项与方向讨论。不做列表是累积决定，单项推翻需要 owner 新决定。

## 重访条件

- owner 明确推翻某一项不做决定。
- 出现准入判据覆盖不了的新能力类别（先问 owner，不自行扩判据）。
