# BySpace Project Spec

## 当前产品

BySpace 是一个 Web + CLI 环境，用于从浏览器或命令行监控和控制本机 AI coding agents。代码、凭据、Agent 进程、工作区和持久状态都留在本地 Node.js daemon；远程浏览器通过自托管的端到端加密 Relay 与 daemon 通信。

## 发行边界

- 支持：浏览器 Web/PWA、`byspace` CLI、本地 daemon、Cloudflare encrypted control relay，以及可选的 daemon-hosted 私有 Remote Web Service 数据面。
- 保留：Paseo `v0.2.0` 中的直接 Provider、ACP、自定义 Provider、Terminal、Git/worktree、Schedule、Loop 与 MCP 能力；Voice conversation/TTS 已由本地 Dictation 取代。
- 不支持：Electron、原生 iOS/Android、app-store/APK、marketing website、Electron Browser automation。

## 私有远程 Web 服务

一台已运行 BySpace daemon 的设备可以通过稳定的本地 URL，访问另一台 daemon 的 loopback Web 服务。源端映射产生 `http://<name>.remote.localhost:<source-daemon-port>`；同一种映射承载普通 HTTP、SSE 与 WebSocket/HMR，不区分 AI Gateway、开发服务器或其他 Web 服务。

```text
浏览器或源端本地 HTTP 客户端
        │  仅 loopback
        ▼
源 daemon Service Proxy（稳定 .remote.localhost URL）
        │  daemon-to-daemon E2EE
        ▼
独立 WSS Data Relay（只转发密文）
        │
        ▼
目标 daemon → 127.0.0.1/::1:<已授权端口>
```

### 控制面与数据面

现有 Cloudflare Relay 只继续承载 Web App 与 daemon 的控制消息。Remote Web Service 的高频数据进入独立 WSS Data Relay，不经过 Worker 或 Durable Object。任意 BySpace daemon 都可以在与完整 daemon API 不同的端口上可选托管 Data Relay；公网入口只能反向代理它的 `/ws` 与 `/health`，不能暴露 daemon API。

Data Relay access token 是整个 Relay 的带宽与可用性门，不授予目标 loopback 访问权。Relay 只维护内存中的 Relay v2 socket 配对，拒绝活动 control/data socket 替换，并对物理连接、待配对连接、frame、缓冲字节和慢端背压设总量与单会话上限。它能看到连接地址、时序、密文长度、路由标识和公钥握手，但不能读取 HTTP header/body、SSE、WebSocket 消息、Prompt、API Key 或模型输出。

### 映射、授权与身份

源 daemon 原子持久化 mapping ID、本地名称、稳定 hostname、目标 daemon 身份/长期公钥和目标端口。目标 daemon 独立持久化精确 grant：mapping ID、源 daemon 长期公钥和目标端口必须同时匹配，目标才会连接自己的 `127.0.0.1` 或 `::1`。源映射是授权 desired state；管理 UI 在映射存在且目标重新在线时幂等修复 grant，因此 create 响应丢失或目标短暂离线不会永久留下未授权映射。删除先幂等撤销目标 grant，再删除源映射；撤销阻止新连接，不中断已经建立的流。

每次数据连接由目标发出不可预测的新 challenge，源端 open 必须绑定该 challenge；握手后每个 frame 都绑定本连接的 session ID 与严格单调序号。旧 open、重复 frame、乱序 frame 和跨连接重放都会在明文进入 loopback 服务前被拒绝。源端 `.remote.localhost` 路由也按真实 TCP 来源限制为 loopback，不能由 Host 或代理 header 绕过。

### 持久性、部署与失败语义

Relay endpoint、TLS 选择和 access token 都是 daemon 运行配置，不写入 mapping 或 grant。当前可以让家里设备 B 托管 Data Relay 并通过自己的入口暴露；以后迁移到 VPS 时，只需在 VPS 安装普通 daemon、启用独立 Data Relay listener、配置 Caddy/nginx，并修改参与 daemon 的 endpoint/token 后重启。已有 mapping、grant 与 `.remote.localhost` URL 不变。

源 daemon 重启后恢复映射与 hostname；Data Relay 或目标暂时离线不会删除它们。网络断开会立即终止当前 HTTP/SSE/WebSocket 流并有界清理两端资源，后续新请求重新建链。系统不缓存、重放、断点续传或恢复活动请求。

该能力通过 `server_info.features.remoteWebServices` 集中检测；新客户端面对不支持的 daemon 只提示升级，不用旧 RPC 模拟降级路径。它不提供公共 preview URL、浏览器直连、任意 TCP/UDP、SSH、数据库代理、P2P/TURN、NAT 打洞、TUN/native helper、AI 专属类型、Provider 自动配置或 API Key 托管。

## Dictation

语音输入只提供显式开始/停止的本地 Dictation，不提供 Voice conversation、TTS、VAD、实时预览或自动发送。录音期间现有草稿保持可见且不变，停止后只追加一次最终转写；取消不会改动草稿。

Host 通过设置页显式下载、选择或删除 allowlist 中的 FireRedASR2-AED 与 SenseVoice Small 模型；默认不选择、不下载任何模型。模型选择与文件均属于 Host，浏览器不持有模型状态。可选 AI refinement 默认关闭，只把最终文本交给现有 structured-generation Provider 路径；音频永不发送，失败回退原文，成功结果仍可在 Composer 中切回原文。

## Terminal

Terminal Tab 可以在切换后保留本地 renderer 状态，但保留挂载不等于继续消费输出：只有当前可见的 retained Terminal 持有 daemon stream；隐藏 Tab 立即停止订阅，重新显示时通过 daemon 的权威 snapshot/revision 恢复隐藏期间的最终状态。同屏 split pane 中未聚焦但仍可见的 Terminal 继续持有 stream。

## Git 与 Forge

Git 和 Forge 元数据由 daemon 按需读取：工作区注册、文件变化、计时器与 Agent 输出都不会启动后台 Git 工作；外部变化可保持旧状态，直到首次客户端读取、用户手动刷新、安全关键的 mutation preflight，或 BySpace 自己完成 Git mutation。

手动刷新先发布强制读取的本地 Git 状态并启动 diff，再在后台继续强制刷新 Forge。Forge 完成后的状态更新携带 Pull Request 信息，因此网络延迟不会阻塞 Changes，新发现的 Pull Request 仍会自动出现。

## Agent Timeline

空闲 Provider runtime 回收不阻塞已有 Timeline 首屏：浏览历史不唤醒 Provider，继续执行时才恢复。

## 侧栏 Workspace 导航

侧栏以 Project 作为定位 Workspace 的唯一信息结构，不再提供独立的 Status 视图。状态只做原位表达（行内 ⚠ 计数、状态点），不参与排序；标题栏的「待处理」过滤按钮（⚠）开启后只显示需要用户操作的会话，是用户主动的视图切换，不引起重排。

```text
Workspaces                     [⚠ N] [+] [搜索] [显示偏好]

Project A       ⚠ N                               [+]
    Workspace A1  ⚠ N
    Workspace A2  ● N
Project B                                           [+]
    Workspace B1  ● N
Empty project                                       [+]
```

Project 只出现一次；全部 Project 与 Workspace 的顺序一律是用户管理序（拖拽顺序，新增追加），选中、Agent 活动与状态变更都不触发重排。Project 行无收起/展开，Workspace 无置顶。

Workspace 行常驻显示需要处理或正在工作的 Agent 数；Hover 在保留 Workspace 元数据的同时，按父子层级展示全部未归档 Agent 及其精确状态。行内摘要是关键状态入口，不能依赖 Hover。daemon 汇总的 Workspace 状态（包括 Terminal 活动）与 Agent 细分状态共同参与状态显示，但都不改变顺序。

首 prompt 生成的 Workspace title 与 worktree branch 只作为一次性初始名，不随对话持续漂移。Workspace 菜单的「Rename with agent」仅复制固定 prompt，用户自行粘贴给最理解当前工作的 Agent；Agent 先设置 title，再 best-effort 重命名仍为 BySpace 生成、未发布、无 upstream/PR/MR 且无冲突的 worktree branch。title 与 branch 是两个独立操作，branch 不满足条件时保留原名并说明原因。

侧栏不提供独占整行空间的全局 `New workspace` 行。Workspaces 标题栏 `+` 是常驻全局入口；每个 Project 行的 `+` 是当前项目内创建 Workspace 的上下文入口，空 Project 也通过它创建第一个 Workspace；`Cmd/Ctrl+N` 保留为全局加速入口。三者进入同一个 Project-first Composer。

显式 Project 或当前 Workspace 上下文会预填 Project；没有当前 Workspace 上下文时先自动展开 Project picker，不沿用过时的 remembered Project。当前 Workspace 的 `Cmd/Ctrl+N` 会沿用其显式 Host；单一可创建位置自动落定；多个可创建位置一律要求用户选择 Host，不根据最近使用或在线状态猜测。Isolation 保持内联次级选项，Base branch 仅在 Worktree 时显示。

## 项目准备

Project Settings 保留对 `byspace.json` 的精确手工编辑，也提供 Configure/Review with agent 入口。入口始终沿用当前 Host、项目与仓库目录，只创建一份可检查和修改的 Agent draft，不自动发送或直接修改项目。

Agent 使用 bundled `byspace-project-setup` Skill 检查干净 worktree 的可重复准备、高频命令的可发现性，以及长期服务的并行运行风险。建议必须由仓库证据导出并在修改前展示；现有配置和未知字段应保留，secrets、共享资源与破坏性操作必须单独确认。

只有声明支持该 Skill 的 Host 才显示可执行入口；Skill 未安装或版本漂移时先安装或更新，失败保留当前项目上下文并允许重试。旧 Host 只提示升级，不用普通 Agent prompt 模拟降级能力。

## 身份与发布

- 产品：BySpace
- npm/CLI：`@bytetrue/byspace` / `byspace`
- 环境变量：`BYSPACE_*`
- daemon home：`~/.byspace`
- 默认端口：`6777`
- Web：`https://app.byspace.cc.cd`
- Relay：`wss://relay.byspace.cc.cd:443`

## Agent 聊天完整性

- daemon 已提交的 Timeline 是聊天完整性的权威来源；live stream 负责低延迟展示，保留 subscription 不能证明浏览器没有漏收消息。
- 初始化、窗口恢复、重新显示 Workspace、gap 修复、显式刷新、rewind/reload 与旧历史分页共享每个 Host 的单一同步所有者；向前追赶和向前翻旧历史互不取消。
- 恢复前台或窗口焦点时立即权威追赶到当前 tail。并发响应按连接代际、Timeline epoch、cursor 与 source sequence ranges 合并，而不是按请求发出顺序判新旧；错误响应不能把聊天标记为已就绪。

## 来源与维护

当前源码以首次干净引入的 Paseo `v0.2.0-beta.1` 为产品基础，并已按 release-delta 流程同步至 Paseo `v0.2.0`；Git 默认分支始终保持 BySpace-only ancestry。LICENSE 和 README 保留上游版权、AGPL 与来源归属。后续只按 Paseo 正式 release 审查并移植聚合差异，不导入上游提交历史。
