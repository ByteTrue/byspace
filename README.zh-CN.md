<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="BySpace logo">
</p>

<h1 align="center">BySpace</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/ByteTrue/byspace/stargazers">
    <img src="https://img.shields.io/github/stars/ByteTrue/byspace?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/ByteTrue/byspace/releases">
    <img src="https://img.shields.io/github/v/release/ByteTrue/byspace?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode 和 Pi agents 的统一界面。</p>

<p align="center">
  <img src="packages/website/public/hero-mockup.png" alt="BySpace app screenshot" width="100%">
</p>

<p align="center">
  <img src="packages/website/public/mobile-mockup.png" alt="BySpace mobile app" width="100%">
</p>

---

在你自己的机器上并行运行 agents。无论在手机上还是桌前，都能推进交付。

- **自托管：** Agents 在你的机器上运行，使用完整的本地开发环境、工具、配置和技能。
- **多提供商：** 通过同一个界面使用 Claude Code、Codex、Copilot、OpenCode 和 Pi。为每个任务选择合适的模型。
- **语音控制：** 在语音模式下口述任务或讨论问题。需要免手操作时很方便。
- **跨设备：** 支持 iOS、Android、桌面端、Web 和 CLI。在桌前开始工作，用手机查看进度，也可以从终端脚本化操作。
- **隐私优先：** BySpace 没有遥测、追踪，也不会强制登录。

## 快速开始

BySpace 会运行一个名为 daemon 的本地服务，用来管理你的 coding agents。桌面 app、移动 app、Web app 和 CLI 等客户端都会连接到它。

### 前置条件

你至少需要安装一个 agent CLI，并用你的凭据完成配置：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### 桌面 app（推荐）

从 [BySpace GitHub Releases](https://github.com/ByteTrue/byspace/releases) 下载。打开 app 后 daemon 会自动启动，不需要再安装其他东西。

如果要从手机连接，在 Settings 中扫描显示的二维码。

### CLI / 无头模式

安装 CLI 并启动 BySpace：

```bash
npm install -g @bytetrue/byspace@beta
byspace
```

BySpace 默认在 `127.0.0.1:6777` 启动。终端会询问是否启用端到端加密 relay；也可以通过 TCP、Tailscale 或其他 VPN 直接连接。

完整安装和配置见：

- [开发与安装](docs/development.md)
- [架构](docs/architecture.md)
- [Server 与 CLI 参考](packages/server/README.md)

## CLI

你能在 app 中完成的事情，也都可以在终端中完成。

```bash
byspace run --provider claude/opus-4.6 "implement user authentication"
byspace run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

byspace ls                           # 列出正在运行的 agents
byspace attach abc123                # 实时流式查看输出
byspace send abc123 "also add tests" # 发送后续任务

# 在远程 daemon 上运行
byspace --host workstation.local:6777 run "run the full test suite"
```

更多内容见 [Server 与 CLI 参考](packages/server/README.md)。

## Skills

安装 BySpace 内置 skills：

```bash
npx skills add ByteTrue/byspace
```

然后在任意 agent 对话中使用：

- `/byspace-handoff` — 在 agents 之间交接工作。我会用它先和 Claude 规划，再交给 Codex 实现。
- `/byspace-advisor` — 启动单个 agent 作为 advisor，提供第二意见，但不把工作委托出去。
- `/byspace-committee` — 组建两个风格互补的 agents，让它们后退一步做根因分析并产出计划。

## 开发

Monorepo 包结构速览：

- `packages/server`：BySpace daemon（agent 进程编排、WebSocket API、MCP server）
- `packages/app`：Expo 客户端（iOS、Android、Web）
- `packages/cli`：用于 daemon 和 agent 工作流的 `byspace` CLI
- `packages/desktop`：Electron 桌面 app
- `packages/relay`：用于远程连接的 relay 包
- `packages/website`：保留的上游营销站点源码，本发布线不部署

常用命令：

```bash
# 运行所有本地开发服务
npm run dev

# 单独运行某个界面
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# 构建 server stack
npm run build:server

# 全仓库检查
npm run typecheck
```

## 相关项目

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — 官方分布式 relay，使用 Elixir 编写
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code 扩展

### 自托管 relay TLS

自托管 relay 默认使用 `ws://`，除非显式启用 TLS。对于 nginx 后面、监听 443 的 relay，可以这样启动 daemon：

```bash
BYSPACE_RELAY_ENDPOINT=127.0.0.1:8080 \
BYSPACE_RELAY_PUBLIC_ENDPOINT=relay.example.com:443 \
BYSPACE_RELAY_USE_TLS=true \
byspace daemon start
```

等价配置：

```json
{
  "daemon": {
    "relay": {
      "enabled": true,
      "endpoint": "127.0.0.1:8080",
      "publicEndpoint": "relay.example.com:443",
      "useTls": true
    }
  }
}
```

最小 nginx WebSocket 代理配置：

```nginx
server {
  listen 443 ssl;
  server_name relay.example.com;

  ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## License

Apache-2.0
