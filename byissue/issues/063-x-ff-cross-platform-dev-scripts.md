---
kind: issue
title: "将开发环境启动脚本重构为跨平台 Node 脚本，修复 Windows/PowerShell 下执行失败"
type: ff
status: closed
created: 2026-10-01
closed: 2026-10-01
---

# 将开发环境启动脚本重构为跨平台 Node 脚本，修复 Windows/PowerShell 下执行失败

## 做了什么

byspace.json 中的 daemon、app、ios-simulator 之前使用 POSIX 风格的命令内联环境变量前缀（如 BYSPACE_DEV_MANAGED_HOME=1 ... ./scripts/dev-daemon.sh）。由于 BySpace 依赖系统原生 Shell 执行命令，在 Windows 下由 PowerShell 执行时，该语法报 The term BYSPACE_DEV_MANAGED_HOME=1 is not recognized as a name of a cmdlet。

遵循 docs/development.md 原有规范（“Put that logic in a Node script that reads what it needs from process.env”），本修改不侵入 BySpace 核心协议和守护进程代码，而是将开发脚本与环境准备逻辑改用 Node.js（.mjs）跨平台实现：

1. **scripts/dev-home.mjs**：替代 scripts/dev-home.sh，跨平台完成 BYSPACE_HOME 目录创建、元数据种子复制（复用 Node cpSync）、config.json 守护进程监听与 CORS 配置，以及端点解析；直接执行时作为 CLI 包装器启动传入命令。
2. **scripts/dev-daemon.mjs**：读取 BySpace 服务注入的 BYSPACE_SERVICE_DAEMON_PORT 并设置监听、创建语音模型目录、执行构建依赖与 watch。
3. **scripts/dev-app.mjs**：替代 scripts/dev-app.sh，自动读取 BYSPACE_SERVICE_DAEMON_PORT 与分配的端口，解析端点并启动 Expo。
4. **byspace.json**：所有服务脚本统一改为直接调用 node ./scripts/<name>.mjs，完全消除 Shell 语法差异，在 Windows（PowerShell/cmd）与 POSIX（bash/zsh）下表现完全一致。
5. **package.json**：dev:server、dev:app 与 cli 同步改用 node ./scripts/...，同时修复 Windows 下 npm run cli 因 ./scripts/dev-home.sh 无法被 cmd 识别而失败的问题。
6. 三个旧 .sh 壳（dev-home.sh / dev-daemon.sh / dev-app.sh）已在 PR #14 删除：全仓无调用者，只是 exec node 转发。

## 改了哪些

- byspace.json
- package.json
- docs/development.md
- scripts/dev-home.mjs（新增）
- scripts/dev-daemon.mjs（新增）
- scripts/dev-app.mjs（新增）
- scripts/dev-home.test.mjs（新增）
- scripts/dev-home.sh、scripts/dev-daemon.sh、scripts/dev-app.sh（PR #14 删除）

## 怎么验证的

- 单测：node --test scripts/dev-home.test.mjs（3/3 绿）、node --test scripts/seed-worktree-dev-state.test.mjs（7/7 绿）。
- PowerShell 实机执行：
  - powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run cli -- --help"（正常打印帮助，无报错）。
  - powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:BYSPACE_PORT='6779'; $env:BYSPACE_SKIP_DEV_SERVER_BUILD='1'; node ./scripts/dev-daemon.mjs"（PowerShell 下正常打印 Banner 并成功启动 watch 进程）。
  - powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:BYSPACE_PORT='8099'; $env:BYSPACE_SERVICE_DAEMON_PORT='6779'; node ./scripts/dev-app.mjs"（PowerShell 下正常启动 Metro）。
- 代码规范：npm run lint（0 warning, 0 error）、npm run typecheck（全工作区 0 error）、npm run format:check（100% 通过）。

## 对 byissue/ 的影响

无影响。完全对齐了 docs/development.md 中关于跨平台命令使用 Node.js 承载的最佳实践。
