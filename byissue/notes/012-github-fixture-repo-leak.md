---
kind: note
title: "e2e 的 GitHub fixture 会静默泄漏仓库，最后以「创建太频繁」的形式暴露"
created: 2026-10-13
---

# e2e 的 GitHub fixture 会静默泄漏仓库，最后以「创建太频繁」的形式暴露

`gh repo delete` 需要 token 的 `delete_repo` scope。只做过 `gh auth login` 的机器上删除一律 403，而每处 cleanup 都包在 `try/catch` 里（注释写着 preserve the original test failure），于是**每跑一次泄漏一个 `byspacetmp-*` 仓库，没有任何信号**。

真正暴露它的是配额：攒到约 20 个之后 GitHub 开始对 `gh repo create` 回 `You have created too many repositories, too quickly`。这条看起来像 fixture 坏了，其实是配额。2026-10-13 清理掉的 20 个里，最早两个（`byspacetmp-unrelated-merge-*`）建于 08-24 与 10-03 —— 这个泄漏已经静默存在约七周，期间每次手动跑那几个 real e2e 都会再加一个。

## 诊断

看到 `repo create` 报「too many repositories」时，先数泄漏的仓库，再怀疑代码：

```bash
gh api --paginate "user/repos?per_page=100&affiliation=owner" --jq '.[].name' | grep '^byspacetmp-'
```

`byspacetmp-` 前缀专为批量清理而设（`packages/server/src/server/test-utils/temp-github-repo.ts`），删起来安全：

```bash
gh auth refresh -h github.com -s delete_repo
gh api --paginate "user/repos?per_page=100&affiliation=owner" --jq '.[].name' \
  | grep '^byspacetmp-' \
  | xargs -I{} gh repo delete OWNER/{} --yes
```

## 为什么会漏掉两处

判定「这台机器能不能跑 GitHub 测试」的代码在仓里有**四份拷贝**，名称各异（`hasGithubAuth` / `hasGitHubCliAuth` / `hasGitHubTestAccess`），四份里三份只看 `gh auth status`，只有 `checkout-pr-merge.e2e.test.ts` 一份额外查了 scope。三份错的两份在 server（`checkout-ship`、`auto-archive-unrelated-github-merge`），都不在 CI 的 server-tests 文件列表里，只在手动跑时泄漏；第三份在 app。CI 没有 `gh` 认证、这些 spec 全部跳过，所以 CI 从头到尾没碰到过这条路径。

现在收敛成一处每包：`canCreateTempGithubRepos()`（server）与 `canCreateGithubFixtures()`（app）。app 不依赖 server，跨不了包，只能留两份并互相注释指路。判定逻辑本身用 Node 直接验过：有 scope → true，无 scope / 未认证 → false。

写测试的规则在 [docs/testing.md](../../docs/testing.md) 的 "Running tests locally"。

相关：[011-playwright-spec-cross-file-project-leak](011-playwright-spec-cross-file-project-leak.md) 是同一类问题的另一半 —— app 侧 daemon **项目**记录泄漏，这条是 GitHub **仓库**泄漏。两者的共同形状：清理失败被 `catch` 吞掉，症状延后到下一个不相关的测试才出现。
