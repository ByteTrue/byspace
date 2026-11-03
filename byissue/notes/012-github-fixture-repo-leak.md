---
kind: note
title: "e2e 的 GitHub fixture 会静默泄漏仓库，最后以「创建太频繁」的形式暴露"
created: 2026-10-13
---

# e2e 的 GitHub fixture 会静默泄漏仓库，最后以「创建太频繁」的形式暴露

在线 GitHub 用例（`createTempGithubRepo`）会在 `gh` 登录的账号里真建 `byspacetmp-*` 私有仓库，用完删掉。删不掉时**没有任何信号**：清理包在 `try/catch` 里，为的是不盖住测试本身的失败。泄漏一直攒着，攒到约 20 个后 GitHub 开始对 `gh repo create` 回 `You have created too many repositories, too quickly`，看起来像 fixture 坏了，其实是配额。2026-10-13 清掉 20 个，最早的建于 08-24。

## 漏的几条路

| 路径                                                                                                                               | 发现         | 现在                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| token 没有 `delete_repo` scope，删除一律 403                                                                                       | 10-13（079） | `canCreateGithubFixtures()` 查 scope，没有就跳过这些用例                                               |
| 建仓之后的步骤在 `try` 之外（new-workspace 的 clone、composer-attachments 开工作区）                                               | 11-02（#37） | 建仓之后的每一步都放进 `try`，`finally` 删仓                                                           |
| `createTempGithubRepo` 内部在 `repo create` 之后失败（如 `--push` 失败），调用方拿不到 fixture 去删                                | 11-03        | 它自己在失败时删掉已建的仓库                                                                           |
| 钩子或用例超时：清理先跑了，fixture 还在建、拿不到；建完以后没人删（pr-pane 的 `beforeAll` 建 6 个 PR 要一分多钟，默认 60 秒超时） | 11-03        | 仓库名带本次运行的 id，global teardown 删掉本次运行剩下的仓库和本地克隆；pr-pane 的钩子超时改为 4 分钟 |
| 进程在 teardown 之前被杀（SIGKILL、断电）                                                                                          | 11-02（#37） | 下一次运行的 global setup 删掉建于 30 分钟前的 `byspacetmp-*` 仓库和 `/tmp` 里的本地克隆               |

后两条兜住所有没想到的路：清理和测试进程同生共死，只靠用例自己清永远有漏。teardown 按运行 id 删，删的都是本次运行的、已经不会再用的；setup 按 30 分钟删，为的是不误删另一个正在跑的运行刚建的仓库。CI 没有 `gh` 认证，这些用例和扫除都不会跑。

## 诊断

```bash
gh api --paginate "user/repos?per_page=100&affiliation=owner" --jq '.[].name' | grep '^byspacetmp-'
```

global setup 与 teardown 每次都会扫，手动删只在急用时需要（`byspacetmp-` 前缀专为批量删除而设，删起来安全）：

```bash
gh api --paginate "user/repos?per_page=100&affiliation=owner" --jq '.[].name' \
  | grep '^byspacetmp-' \
  | xargs -I{} gh repo delete OWNER/{} --yes
```

## scope 判定为什么曾经漏了两处

判定「这台机器能不能跑 GitHub 测试」的代码曾有四份拷贝，三份只看 `gh auth status`、不查 scope，其中两份在 server 的手动用例里，CI 从没跑过。081 收敛成每包一处；Node 版 server 归档后只剩 `web/e2e/support/helpers/github-fixtures.ts` 的 `canCreateGithubFixtures()` 这一处。

写测试的规则在 [docs/testing.md](../../docs/testing.md) 的 "Running tests locally"。

相关：[011-playwright-spec-cross-file-project-leak](011-playwright-spec-cross-file-project-leak.md) 是同一类问题的另一半 —— daemon **项目**记录泄漏，这条是 GitHub **仓库**泄漏。两者的共同形状：清理失败被 `catch` 吞掉，症状延后到下一个不相关的测试才出现。
