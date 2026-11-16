# Provider 设置：存了不等于传了

## 结论

- provider 适配最高频缺陷是「设置持久化了但从未传给 provider」：一轮排查抓到五个（env、featureValues、mode、thinking、systemPrompt）。App 里每个 provider 设置必须有一条到达 provider 的通道（启动 flag / RPC 参数 / 配置项 / 消息字段），检查表在 docs/providers.md。
- Go 侧同型陷阱：create_agent_request 解码进显式 Config struct（internal/server/server.go:2629 附近），未列出的字段静默丢弃，编译器不报错。已发生的实例：Labels 只从 config 读丢了顶层 labels（含 parent link）；ProviderOptions 缺席丢了 provider 弹层全部设置；FeatureValues 缺席使 mock 计数器全部无效。
- 新增会话配置字段时，先确认它在解码 struct、持久化、wire schema 三处都登记（Node 时代是三道显式白名单，Go 时代是显式 struct + 持久化路径）；再想清楚字段属于「持久化文本」还是「每次启动重算」（先例：daemonAppendSystemPrompt 不持久化，每次从 daemon 设置重算；role 只存名字，提示词每次从角色注册表重解析）。

## 依据

- 类型：可重跑证明（缺陷实例均有修复）+ 长期约束（docs/providers.md 检查表）。
- 被否决的相关方案：相信「存进配置就生效」（五连漏证明不成立）；给新字段只加类型不加登记（编译器不管显式白名单）。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/2026-11-09-settings-stored-but-not-transmitted.md`、`010-agentsessionconfig-field-three-registries.md`（Node 时代原始三处登记）；Go 代码注释 `internal/server/server.go:2625-2647`（三个静默丢弃实例的记录）。
- 适用条件：所有 provider 设置与会话配置字段改动。Node 三处登记的具体文件已不存在，Go 的对应点是解码 struct 与持久化路径。

## 重访条件

- create_agent_request 解码改为通用 map（显式白名单消失）。
- 新增持久化层或配置字段类别。
