---
kind: issue
title: "修复 main 上三个过期测试：技能默认安装与 provider 启动前提"
type: ff
created: 2026-11-11
---

# 修复 main 上三个过期测试

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

做 Windows PATH 修复时跑 `npm run audit`，发现三个失败在干净 HEAD 上同样存在（`git worktree` 对照确认）。都是断言写在行为改变之前，测试还在描述旧世界。

- 改动：
  - `internal/server/skills_test.go` — 删除 `TestBootRepairInstallsOnlyTheReferenceSkillWithoutAStoredSelection`。它断言首次启动安装 `byspace` 参考技能，和 `f3a5f2009`（默认不安装）及同文件新增的 `TestSkillInstallRequiresAnExplicitSelection` 直接矛盾；后者已经覆盖「构造不写盘、无选择不安装、显式选择才安装」三半。
  - `internal/server/skills_uninstall_test.go` — `New(...)` 之后显式调用 `AutoUpdateInstalledSkills()`（安装前后各一次）。`48258eaf1` 把启动维护移出了构造器，测试仍在指望 `New` 做修复。原先偶发的 `TempDir RemoveAll: directory not empty` 也随这个路径消失。
  - `internal/agent/providers/provider_command_test.go` — 旧断言「stub 退出 0 时启动应报错」在 `d3af51ec4` 让 `BuildLaunchArgs` 也会解析 PATH 之后不成立：启动现在会成功并返回会话。改为 stub 写 marker 文件，断言启动无错且解析到的可执行文件真的跑了，再保留 `ResolveProviderCommand` 的解析断言。
- 验证：`go test ./internal/server ./internal/cli ./internal/gui ./internal/store ./internal/daemon ./internal/execres ./internal/agent/providers` 全绿；`npm run audit -- --no-browser` 全过。
- byissue：无影响。三个测试的旧断言描述的行为已在上述提交里被有意改掉，没有 spec 需要更新。
