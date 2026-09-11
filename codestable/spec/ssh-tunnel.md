---
kind: spec
title: "SSH 隧道由 daemon 承接"
type: feature
status: draft
created: 2026-09-11
issue: 025 (A5)
---

# SSH 隧道由 daemon 承接

## 背景与目标

Electron 退出后，Remote SSH 是唯一没有 Web 替代路径的桌面能力（`host-runtime.ts:531` 直接抛 "Remote SSH is only available in the desktop app"）。本 spec 定义 Web/PWA 经**已连接的 daemon** 建立到远端 daemon 的 SSH 隧道，替代 Electron 的 `local-transport.ts`。它是 Electron 退出的前置闸门（issue 025 A5）。

```text
浏览器 / 手机 PWA
       ↓ WebSocket（既有 session 协议）
daemon A（用户已连接、已完成配对/认证的机器）
       ↓ ssh（系统二进制，密钥/agent 认证）或 ssh2（密码认证）
远端 daemon B（sshd 可达，daemon 监听 127.0.0.1:6777）
```

## 范围

**做：**

- daemon 新增 `tunnel.ssh.*` RPC 族（open / close / probe / respond-host-key / list），带 `tunnel.manage` 权限门
- 认证路径完整保留现有语义：密钥/agent 走系统 `ssh` 二进制（BatchMode，凭据永不进入 daemon 进程）；密码走 `ssh2` 库
- 主机指纹 TOFU：daemon 端存储 pin（`$BYSPACE_HOME/tunnel-known-hosts.json`，从 Electron userData 迁移语义，不搬 Electron 数据），Web UI 弹确认（first-use / changed 两种），指纹变更即拒绝
- Web UI：添加 Remote SSH 主机的入口（复用 Electron 版交互形态，迁移到 Web）
- 已保存 Electron SSH Host 的接续：daemon A 侧的 host 管理已有 `host-runtime` 体系，接续方案见下

**不做（明确出界）：**

- 不做远端安装/启动 daemon、机器运维平台——只连接已运行的 daemon
- 不搬迁远端会话、不合并两台 daemon 的数据
- 不让任意已配对客户端默认借用 daemon 的 SSH 身份——每次连接需要 `tunnel.manage` 权限的客户端显式发起（见鉴权边界）
- 不做代理链（A→B→C）
- 不在本批次做 Electron SSH 代码的删除（那是 Electron 退出批次）

## 为什么这样设计

**为什么 RPC 而不是在 daemon 上开本地转发端口。** 浏览器连不到 daemon 的 localhost 端口（跨机时），也不该让隧道绕过 session 层的认证、授权与事件模型。走 session RPC 让隧道数据天然继承已配对客户端的身份与 `tunnel.manage` 门，且手机 PWA 与桌面浏览器行为一致。

**为什么数据面走 base64 帧。** session 协议是 JSON 文本 + 二进制帧并存；SSH 隧道的 WS 流量复用 Electron 版已验证的 `text/binaryBase64` 封装语义（`local-transport.ts` 的 `TransportEventPayload`），daemon 侧转换成本可忽略，客户端无需新传输库。

**为什么密码认证留在 daemon 进程内（ssh2）。** OpenSSH 批处理模式无法安全传密码（进程列表泄漏）；ssh2 在进程内完成握手，密码不落盘、不进环境变量。指纹确认在握手内异步挂起（hostVerifier async 形式），等待 Web UI 应答——与 Electron 版语义一致。

**为什么 probe 独立成 RPC。** 密钥路径需要先探远端指纹（`authHandler: () => false` 的 none-attack），再决定是否弹确认。Electron 版把它内联在连接流程里；RPC 版拆成显式 `tunnel.ssh.probe` 让 Web UI 能先展示指纹再发起连接，交互更清晰，也复用同一验证逻辑。

## 协议设计

新增 RPC（全部走既有 `SessionInboundMessage/OutboundMessage` 判别联合，点分命名 + `.request/.response`，请求字段顶层、响应字段在 `payload` 下）：

### tunnel.ssh.open.request / .response

```ts
// request
{
  type: "tunnel.ssh.open.request",
  tunnelId: string,        // 客户端生成，^[A-Za-z0-9_-]{1,128}$
  host: string,            // [user@]hostname，复用 validateSshHost
  sshPort?: number,
  daemonPort?: number,     // 默认 6777
  authMode: "key" | "password",
  password?: string,       // authMode=password 时必填；daemon 不持久化
  requestId: string,
}
// response payload
{
  tunnelId, success, error: string | null, errorCode: string | null,
  requestId,
}
```

打开后 daemon 与客户端之间以推送事件流转发 WS 帧（见下）。`open` 只代表隧道建立（TCP+SSH 通道就绪），不代表远端 daemon 的 WS 握手完成——那由客户端在隧道流上完成 `hello`。

### tunnel.ssh.probe.request / .response

```ts
// request
{ type: "tunnel.ssh.probe.request", host, sshPort?, requestId }
// response payload
{
  reachable: boolean,
  fingerprint: string | null,   // SHA256:...；探不到为 null
  keyType: string | null,
  pinnedFingerprint: string | null,  // daemon 侧已 pin 的值
  verdict: "new" | "pinned" | "changed" | null,
  requestId,
}
```

密钥路径 open 前先 probe：`verdict` 为 `new/changed` 时 UI 先走确认流程（respond-host-key），再 open。

### tunnel.ssh.respond-host-key.request / .response

```ts
// request
{ type: "tunnel.ssh.respond-host-key.request", hostKeyPromptId, decision: "trust" | "cancel", requestId }
// response payload
{ tunnelId: string | null, accepted: boolean, error: string | null, requestId }
```

密码路径的指纹确认发生在握手内：open 请求后 daemon 推送 `tunnel.ssh.host_key_prompt` 事件，UI 应答本 RPC；180s 未应答取消（与 Electron 版一致）。

### tunnel.ssh.close.request / .response

```ts
// request
{
  type: ("tunnel.ssh.close.request", tunnelId, requestId);
}
// response payload
{
  (tunnelId, success, requestId);
}
```

幂等：关不存在的 tunnelId 返回 success。

### tunnel.ssh.list.request / .response

```ts
// request
{
  type: ("tunnel.ssh.list.request", requestId);
}
// response payload
{
  tunnels: (Array<{
    tunnelId;
    host;
    sshPort?;
    daemonPort?;
    authMode;
    state: "opening" | "open" | "closed";
    openedAt: number;
  }>,
    requestId);
}
```

### 推送事件（daemon → 客户端）

```ts
// 隧道数据帧：把远端 daemon WS 的收发双向搬到客户端
{ type: "tunnel.ssh.frame", payload: { tunnelId, direction: "to_client" | "to_tunnel", text?, binaryBase64? } }

// 隧道生命周期
{ type: "tunnel.ssh.state", payload: { tunnelId, state: "opening"|"open"|"closed", error: string | null } }

// 密码路径的指纹确认请求（挂起握手直到应答或超时）
{ type: "tunnel.ssh.host_key_prompt", payload: { hostKeyPromptId, host, kind: "first-use"|"changed", fingerprint, pinnedFingerprint?: string } }

// 客户端 → daemon 的隧道写入也走 inbound：
{ type: "tunnel.ssh.send.request", tunnelId, text?, binaryBase64?, requestId }
```

`to_tunnel` 帧由客户端经 `tunnel.ssh.send.request` 发起（响应仅确认受理，`{ tunnelId, accepted: boolean, requestId }`）；`to_client` 帧为 unsolicited 推送。

## daemon 侧结构

```
packages/server/src/server/tunnel/
  index.ts            # SshTunnelManager：注册表、生命周期、事件分发
  ssh-tunnel-session.ts  # 单隧道：复用 protocol/ssh-transport 的参数构建
  known-hosts.ts      # 从 desktop 版迁移的 TOFU store（$BYSPACE_HOME/）
  host-key-prompt.ts  # 从 desktop 版迁移的 prompt 管理器（事件化）
```

- **SshTunnelManager** 持有 `Map<tunnelId, Tunnel>`；每隧道一条 `ssh` 子进程（key 模式）或 `ssh2` 连接（password 模式）+ 一条到远端 `ws://127.0.0.1:<daemonPort>/ws` 的本地 listener→pipe 桥。直接移植 `local-transport.ts` 的 `createSshProxy`/`connectPasswordSshTunnel`/`prepareKeyPathSpawn` 逻辑，把 Electron 依赖（`app.getPath`、`BrowserWindow` 事件广播）替换为 manager 的 emit 回调。
- **权限**：`operation-permissions.ts` 为全部 `tunnel.ssh.*.request` 注册 `tunnel.manage`；推送事件不加出站授权条目（与 providers_snapshot_update 同类处理）。
- **Bootstrap 接线**：`SshTunnelManager` 在 bootstrap 构造，经 `SessionOptions` 传入 Session，Session 新增 `dispatchTunnelMessage()`；manager 的事件经 session emit 推给发起连接的 source（`emitForSource` 语义，隧道事件只发给拥有者；后续若多客户端可见性有需求再扩展）。
- **校验**：zod schema 纯净（无 transform/catch），messages.ts 改动后 `npm run generate:validators` 自动再生。

## 鉴权边界（安全设计）

1. **发起门槛**：`tunnel.ssh.*` 全部要求 `tunnel.manage`。个人自用模式下配对客户端即拥有该权限；未来多用户时收紧到显式授权。
2. **凭据不落地**：密码只在握手期间存在于 daemon 内存；不写 `$BYSPACE_HOME`、不进日志、不进遥测。密钥路径凭据由系统 ssh/agent 持有，daemon 只见子进程句柄。
3. **指纹 TOFU**：pin 存 daemon 侧（`tunnel-known-hosts.json`，0600），语义与 Electron 版一致；changed 即拒，UI 明示旧/新指纹。密钥路径用受管 known_hosts 临时文件（不读不写用户的 `~/.ssh/known_hosts`）。
4. **隧道事件定向**：`frame/state/host_key_prompt` 只推给打开该隧道的连接 source；其他已连接客户端收不到。
5. **资源回收**：客户端断开时 daemon 关闭其拥有的所有隧道（`closeAll(source)`）；tunnel 打开后 180s 内未完成远端 WS 握手自动回收（防僵尸）。
6. **并发上限**：单 daemon 并发隧道 ≤ 8（可配 `BYSPACE_TUNNEL_MAX`），超出返回 `errorCode: "limit_reached"`。

## Web UI

- 添加主机入口（Add Host / Remote SSH）复用 `add-remote-ssh-host-modal.tsx` 的表单结构，提交改为保存 `remoteSsh` host profile + 走 `tunnel.ssh.probe` → （若 new/changed）确认 → `tunnel.ssh.open`。
- `host-runtime.ts` 的 `remoteSsh` 分支：`desktopTransportFactory` 缺失时不再抛错，改为构造 daemon 中继 transport（新 `packages/app/src/hosts/tunnel-transport.ts`：基于 `DaemonClient` 的隧道 RPC + frame 事件封装出 `TransportFactory` 形状）。
- 连接页与 host badge 显示 SSH 目标（`Remote SSH host`），错误信息透传 daemon 的 failureDetail（ssh stderr 摘要）。
- **接续已保存的 Electron SSH Host**：host profile 已存于 app 侧（浏览器 IndexedDB/本地存储），daemon 侧不持有；Electron 版的 pin（`userData/remote-ssh-known-hosts.json`）不自动搬迁——首次经 daemon 连接时重新走 TOFU 确认（一次性动作，指纹一致则秒过）。文档明示这一点。

## 验证计划

1. **单元**：protocol schema 解析（新旧消息解析互不干扰）；known-hosts verdict 逻辑（沿用 desktop 版测试语义）；tunnel manager 状态机（opening/open/closed、超时回收、幂等 close、并发上限）。
2. **集成（隔离 daemon）**：本机起两个隔离 daemon（A、B），A 上开隧道连 B 的 WS 端口，验证 hello/capabilities 握手、frame 双向转发、关闭回收。密码路径用本机 sshd 的 docker/localhost 模拟不可行时（无 docker），用 key 路径 + 假 sshd（sshd-keygen 临时实例）验证。
3. **e2e（CI）**：Playwright browser 项目加一条 spec：走 probe→open→连上 B 的 daemon UI。依赖 CI 环境有 sshd；若不可行则降级为 mock daemon B（本地 WS server 模拟 hello 握手）。
4. **回归**：CLI `--host ssh://` 路径不回归（不动 CLI 代码）；Electron 版 SSH 在 Electron 退出前继续可用（本批次不动它）。

## 回退

新增 RPC 均为增量（旧客户端不发送即无感知；union 追加不影响旧解析）。daemon 不开新端口、不加新进程。出问题回滚提交即可，无数据迁移。

## 决策待批

- 密码路径保留（含键盘交互式），还是 Web 端只允许密钥认证？**建议保留**：手机场景下用户常无 ssh-agent。
- 并发上限 8 是否合适？**建议先 8**，个人场景足够。
- `tunnel.ssh.send.request` 的受理确认响应是否必要？**建议保留**（背压感知，UI 可显示发送失败）。
