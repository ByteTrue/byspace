# run/agent 环境里的 CLI 走 dist，改源码不重建等于没改

daemon 注入给 agent 会话的 `byspace` 命令解析到 `node_modules/.bin/byspace`，经 workspace symlink 落到 `packages/cli/bin/byspace`，而 bin 执行的是 `packages/cli/dist/index.js` —— **编译产物，不是源码**。因此：

- 在 dev checkout 里改了 CLI 源码（新命令、改参数）而不跑 `npm run build --workspace=@bytetrue/cli`，run 里的 agent 看到的仍是旧 CLI。症状是 agent 如实报告"子命令不存在"，容易被误读成注册/路由问题。
- 判别方法：`grep -c '"<新命令名>"' packages/cli/dist/index.js`，0 即未构建。
- 验证任何"agent 自己用 CLI"的能力前，先确认 dist 时间戳晚于源码改动。

两次踩中：worker 域（2026-09 的 skill/CLI 批）与 multica 域 run 身份链真机验证（Writer 报告 multica 子命令不存在，重建后闭环才通）。同源教训：daemon 本身（strip-types 直跑源码）有热感知错觉，但**它 spawn 出去的 agent 会话走的是构建产物**，两者的"新代码"定义不同。
