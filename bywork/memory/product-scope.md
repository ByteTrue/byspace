# 产品范围：已决定不做与准入判据

## 结论

- 已决定不做的方向：RN native、Electron、iOS 壳、应用商店、npm 分发、SSH、Hub、插件系统、中英以外的界面语言（2026-11-17 砍掉 ar/es/fr/ja/ko/pt-BR/ru 七种，i18n 机制保留，见 docs/i18n.md）、provider 余额/用量报表（2026-11-18 砍掉 quota 整链）、service proxy（2026-11-18 砍掉，见下条）、版本漂移兼容层（见下条）、内置 provider 扩列（2026-11-18 收敛到四内置，见下条）。
- 内置 provider 只留四个（2026-11-18 瘦身批次一，owner 拍板「只留 Pi/Opencode/Claude/Codex 四个内置原生适配器，其他全部不内置走 ACP 让用户自己接入」）：Claude Code（claude-stream）、Codex（codex-rpc）、OpenCode（opencode-http）、Pi（pi-rpc）。copilot 从内置删除改走 ACP catalog 自助接入（command:["copilot","--acp"]）；omp（Oh My Pi）无现成 ACP 桥，实际弃用。ACPPresets（cursor/kimi/kiro/trae）整删，generic ACP host（acp.go）+ web ACP catalog（39 条自助入口）覆盖长尾。EnabledByDefault 机制删除（四内置全默认开）。不建插件内核：冻结契约面（ProviderSpec/ManagedSession + ACP 协议）+ catalog/extends:"acp" 配置，适配成本外部化给用户自己的 agent。详见 docs/providers.md。自助接入机制已补全（2026-11-18）：bundled skill `byspace-provider-adapter`（教用户 agent 写 config entry+验证）+ ACP catalog 39 条；三个根因 bug 已修（command argv tail 不再恒 --acp、provider config env 达进程、params.clientCapabilities 可配），ACP 自助路径端到端可用。
- 不做 service proxy（2026-11-18 瘦身批次一，owner 拍板「已经被 tunnel 完全替代」）：workspace 脚本的 Host 路由代理层（`<script>--<branch>--<project>.localhost`）整链删除，远程访问 dev server 走 tunnel（E2EE relay 端口转发）。脚本功能本体保留：稳定端口分配、PORT/WORKSPACE_SCRIPT_PORT/BYSPACE_PORT/BYSPACE_SERVICE_<NAME>_PORT env、健康检查、scripts button 直连 http://localhost:port。公网层在 Go 里从未接线（Node 时代文档残留）。
- 不做版本漂移兼容（2026-11-18 瘦身批次一，owner 拍板「COMPAT 一个都不应该留」）：app 与 daemon 同 commit 同版本部署，无新旧混跑需求。协议可直接删字段/窄化/改 required，无需 COMPAT 标签与 features 版本门。features 只保留 runtime-state 门（webPush/daemonServiceInstall/daemonTunnels）与 catalog（agentRoleNames）。schema 纯度规则（无 transform/catch/preprocess）仍保留。详见 docs/protocol-compatibility.md。
- 能力准入判据（ADE scope）：一个能力属于 BySpace，当且仅当它不替代用户本来就会调用的东西；工作流住在用户自己的 agent 配置里，daemon 不持有工作流。
- 远程访问走 E2EE relay，不做 P2P（owner 网络环境下打洞从未成功，明确否决）；不依赖 Tailscale/VPN/端口转发。
- Paseo 上游基线冻结在 v0.8.0（2026-09-11），不追上游，只作参考；身份迁移已把 wire 名全部改为 BySpace，无 shim（docs/protocol-compatibility.md）。Paseo 名字只保留三处：README fork 声明、LICENSE 上游版权行、CHANGELOG 上游 PR 链接。
- orca MIT 吸收已放弃（Epic 003，owner 2026-10-14 决定 dropped）：原则是借交互不借架构、UI 用 BySpace 设计系统重做，但整个吸收工作停止。
- 终端内容是唯一真相；hook 活动状态是 best-effort 提示，永不把用户锁在错误状态里。

## 依据

- 类型：用户决定（不做列表、P2P 否决、orca 放弃、语言砍到中英、quota 砍除、service proxy 砍除、无版本漂移政策、内置 provider 收敛到四个均为 owner 拍板）。
- 被否决的相关方案：P2P 打洞；追 Paseo 上游；orca 架构吸收；VelaTerm 式反例（同一事物两套实现 + 两处无人认领的悬挂）。
- 证据或复核方式：`bywork/archive/v1/spec/index.md`（不做列表）、`bywork/archive/v1/notes/005-ade-scope-criteria.md`、`008-tunnel-performance-and-relay-vs-p2p.md`、`bywork/archive/v1/vision` 前身（现 bywork/vision/index.md）、`bywork/archive/v1/epics/003-d-orca-*`（dropped）、`bywork/archive/v1/issues/042-x-paseo-identity-migration.md`、`bywork/work/i18n-two-locales/index.md`（语言砍减）。
- 适用条件：新能力立项与方向讨论。不做列表是累积决定，单项推翻需要 owner 新决定。

## 重访条件

- owner 明确推翻某一项不做决定。
- 出现准入判据覆盖不了的新能力类别（先问 owner，不自行扩判据）。
