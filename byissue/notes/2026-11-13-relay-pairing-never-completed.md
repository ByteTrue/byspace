# 经 relay 的配对从来没连上：三处独立缺陷叠在一起

日期：2026-11-13
状态：已修，本地 e2e 通过

## 现象

`setup-guide-pairing` 在 0.25.0 上必挂：粘贴配对链接、填密码、点 Pair，弹回「Connection timed out」，随后变成「Server disconnected」，前端永远进不了主界面。0.25.0 之前它对无密码主机同样挂，只是当时没人看出原因——我把它当成了「无密码主机被拒」，于是删掉了密码要求。

## 三处缺陷

1. **客户端把挑战回显排在了 `onopen` 之后**（`packages/relay/src/encrypted-channel.ts`）。daemon 要求 `e2ee_challenge` 回显是加密通道里的第一帧，其余全部丢弃。而通道先发 `onopen`，监听器立刻把 hello 和密码证明写进去，回显反而排到了后面。daemon 于是把整条连接当成未证明的，一路丢帧到超时。
2. **密码证明被异步派发**（`internal/server/server.go` `sessionMessageNeedsOrder`）。`auth.password.submit.request` 不在「必须按顺序处理」的名单里，客户端紧接着发来的 hello 由读循环立刻处理，看到的还是「未证明」的 socket，于是按规则关掉它（`Password required`）。
3. **权限表拦住了唯一能建立权限的请求**。证明在权限检查之后才生效，而未证明的 relay socket 没有任何权限，所以证明本身被判 `Permission denied`，`handleRelayPassword` 根本没被调用。

## 为什么现在才发现

本地 e2e 在 Windows 上跑 `bin/byspace.exe`，而那台机器上 `.exe` 是 11-12 的旧构建，我一直在重建无扩展名的 `bin/byspace`。三轮 Go 侧修复都没有进入本地 e2e，看到的失败一直是同一个旧行为。CI 用的是 `make build` 产出的新二进制，所以 CI 的失败才是真实现象。

## 修法

- 回显必须在 `onopen` 之前发出（新增回归测试 `sends the echo before anything an open listener writes`）。
- 密码证明进入「必须按顺序处理」名单（新增 Go 回归测试 `TestRelayConnectionAcceptsHelloBatchedAfterPassword`，两个测试在旧代码上都失败）。
- 权限检查跳过密码证明这一条请求。
- daemon 增加两条日志：拒绝 relay 会话时写明原因；未证明就发 hello 时写明。此前从客户端只能看到「Server disconnected」。

## 调试手段

`docs/development.md`「Running one browser spec locally」记了本地跑单个 spec 的三个开关（`E2E_CHANNEL`、`E2E_VIDEO`、`E2E_PRESERVE_HOME`/`E2E_PRINT_CONSOLE`）和 `.exe` 那个坑。
