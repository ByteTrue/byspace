# 覆盖范围

来源：`rg -n 'uses: actions/setup-node|npm ci' .github/workflows/*.yml`、`docker/Dockerfile`、子任务 `Trace npm release flow` 的调用链调查。

| 来源项 | 所属行为单元 | 覆盖状态 | 覆盖依据 |
|---|---|---|---|
| package.json packageManager | 项目 npm | 已覆盖 | npm@10.9.9 |
| scripts/project-npm.mjs | 外层与嵌套、version 生命周期 | 已覆盖 | 局部 shim，子进程 PATH |
| .github/workflows/ci.yml 的 10 个 setup-node | CI npm | 已覆盖 | 每处后面 setup-ci，format job 跑隔离回归 |
| .github/workflows/release.yml 的 web build | CI npm | 已覆盖 | setup-ci |
| .github/workflows/deploy-app.yml | CI npm | 已覆盖 | setup-ci |
| .github/workflows/release-notes-sync.yml | 无 npm 安装的 Node 脚本 | 不适用 | 不运行 npm，无需切换 npm |
| docker/Dockerfile | 安装与构建 | 已覆盖 | 复制入口并用其运行 ci/build |
| docs/development.md、docs/release.md | 操作约定 | 已覆盖 | 说明 Node 不锁定、局部 npm 入口 |
| 全局安装及 Node 测试矩阵 | 用户边界 | 明确不做 | 不改全局，不顺手修改 CI Node 版本 |
