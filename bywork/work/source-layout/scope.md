# 批次 F 范围：四个类型桶里的平铺模块

事实源（可重跑）：

```
node .dev/probe-f-transitive.mjs   # 每个模块的传递消费者（穿过四个桶向上走）
node .dev/plan-f.mjs               # 生成归属计划 .dev/f-plan.json
node .dev/check-f-roles.mjs        # 计划执行后是否违反 ui/platform 角色规则
```

四个桶共 432 个平铺文件（288 个模块 + 各自的测试）。归属判据按 `docs/coding-standards.md:67-69,74-75`：
目录是模块不是命名空间、路径是名字的一部分、新功能先有家、别丢在最近的根。

- **一个明确的功能归属** → 搬进那个功能目录，去掉与目录重复的前缀（`utils/sidebar-reorder.ts` → `sidebar/reorder.ts`）。
- **真正跨域的原语** → 留在说明它是什么的共享桶（`lib/` 通用助手、`platform/` 浏览器替身、`widgets/` shadcn 之上的应用自建件）。
- 不搬 = 明确不做，理由是跨域；不是遗漏。

覆盖状态：`未处理` → `已覆盖`（搬完并验证）/ `明确不做` / `不适用`。

| 来源项 | 目标 | 依据 | 覆盖状态 |
|---|---|---|---|
| `web/src/utils/agent-attention.test.ts` | `web/src/panels/agent-attention.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/agent-attention.ts` | `web/src/panels/agent-attention.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/agent-command-autocomplete.test.ts` | `web/src/composer/agent-command-autocomplete.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/agent-command-autocomplete.ts` | `web/src/composer/agent-command-autocomplete.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/agent-directory-reconciliation.test.ts` | `web/src/runtime/agent-directory-reconciliation.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/agent-directory-reconciliation.ts` | `web/src/runtime/agent-directory-reconciliation.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/agent-directory-update-policy.ts` | `web/src/runtime/agent-directory-update-policy.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/app-visibility.test.ts` | `web/src/platform/app-visibility.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/app-visibility.ts` | `web/src/platform/app-visibility.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/branch-suggestions.test.ts` | `web/src/git/branch-suggestions.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/branch-suggestions.ts` | `web/src/git/branch-suggestions.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/color.test.ts` | `web/src/lib/color.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/color.ts` | `web/src/lib/color.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/connection-selection.test.ts` | `web/src/runtime/connection-selection.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/connection-selection.ts` | `web/src/runtime/connection-selection.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/desktop-sidebar-toggle.test.ts` | `web/src/screens/desktop-sidebar-toggle.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/desktop-sidebar-toggle.ts` | `web/src/screens/desktop-sidebar-toggle.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/desktop-window-events.ts` | `web/src/platform/desktop-window-events.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/device-timezone.ts` | `web/src/lib/device-timezone.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/diff-highlight.test.ts` | `web/src/git/diff-highlight.test.ts` | domain prefix diff- | 已覆盖 |
| `web/src/utils/diff-highlight.ts` | `web/src/git/diff-highlight.ts` | domain prefix diff- | 已覆盖 |
| `web/src/utils/diff-layout.test.ts` | `web/src/git/diff-layout.test.ts` | domain prefix diff- | 已覆盖 |
| `web/src/utils/diff-layout.ts` | `web/src/git/diff-layout.ts` | domain prefix diff- | 已覆盖 |
| `web/src/utils/diff-rendering.test.ts` | `web/src/git/diff-rendering.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/diff-rendering.ts` | `web/src/git/diff-rendering.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/encode-images.ts` | `web/src/attachments/encode-images.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/error-messages.ts` | `web/src/lib/error-messages.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/exhaustive.ts` | `web/src/lib/exhaustive.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/explorer-paths.test.ts` | `web/src/file-explorer/explorer-paths.test.ts` | domain prefix explorer- | 已覆盖 |
| `web/src/utils/explorer-paths.ts` | `web/src/file-explorer/explorer-paths.ts` | domain prefix explorer- | 已覆盖 |
| `web/src/utils/external-links.test.ts` | `web/src/platform/external-links.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/external-links.ts` | `web/src/platform/external-links.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/extract-tool-call-file-path.test.ts` | `web/src/tool-calls/extract-tool-call-file-path.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/extract-tool-call-file-path.ts` | `web/src/tool-calls/extract-tool-call-file-path.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/file-mention-autocomplete.test.ts` | `web/src/composer/file-mention-autocomplete.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/file-mention-autocomplete.ts` | `web/src/composer/file-mention-autocomplete.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/format-version.ts` | `web/src/lib/format-version.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/host-route-browser.ts` | `web/src/app/host-route-browser.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/image-attachments-from-files.test.ts` | `web/src/composer/image-attachments-from-files.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/image-attachments-from-files.ts` | `web/src/composer/image-attachments-from-files.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/ime-anchor.test.ts` | `web/src/platform/ime-anchor.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/ime-anchor.ts` | `web/src/platform/ime-anchor.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/keyboard-ime.test.ts` | `web/src/keyboard/ime.test.ts` | domain prefix keyboard- | 已覆盖 |
| `web/src/utils/keyboard-ime.ts` | `web/src/keyboard/ime.ts` | domain prefix keyboard- | 已覆盖 |
| `web/src/utils/latency.test.ts` | `web/src/lib/latency.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/latency.ts` | `web/src/lib/latency.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/markdown-list.test.ts` | `web/src/markdown/list.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/markdown-list.ts` | `web/src/markdown/list.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/markdown-parser.test.ts` | `web/src/markdown/parser.test.ts` | domain prefix markdown- | 已覆盖 |
| `web/src/utils/markdown-parser.ts` | `web/src/markdown/parser.ts` | domain prefix markdown- | 已覆盖 |
| `web/src/utils/notification-routing.test.ts` | `web/src/app/notification-routing.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/notification-routing.ts` | `web/src/app/notification-routing.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/open-external-url.ts` | `web/src/platform/open-external-url.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/open-service-url.ts` | `web/src/screens/open-service-url.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/os-notifications.test.ts` | `web/src/push-notifications/os-notifications.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/os-notifications.ts` | `web/src/push-notifications/os-notifications.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/path.test.ts` | `web/src/lib/path.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/path.ts` | `web/src/lib/path.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/project-config-form.test.ts` | `web/src/screens/project-config-form.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/project-config-form.ts` | `web/src/screens/project-config-form.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/project-row-cue.test.ts` | `web/src/sidebar/project-row-cue.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/project-row-cue.ts` | `web/src/sidebar/project-row-cue.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/project-status-badge-content.test.ts` | `web/src/sidebar/project-status-badge-content.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/project-status-badge-content.ts` | `web/src/sidebar/project-status-badge-content.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/provider-command-templates.test.ts` | `web/src/screens/provider-command-templates.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/provider-command-templates.ts` | `web/src/screens/provider-command-templates.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/relative-time-ticker.test.ts` | `web/src/lib/relative-time-ticker.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/relative-time-ticker.ts` | `web/src/lib/relative-time-ticker.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/render-profiler.tsx` | `web/src/performance/render-profiler.tsx` | judged: read the module | 已覆盖 |
| `web/src/utils/review-attachments.test.ts` | `web/src/composer/review-attachments.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/review-attachments.ts` | `web/src/composer/review-attachments.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/rich-clipboard-default-environment.ts` | `web/src/assistant-selection-copy/rich-clipboard-default-environment.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/rich-clipboard.test.ts` | `web/src/assistant-selection-copy/rich-clipboard.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/rich-clipboard.ts` | `web/src/assistant-selection-copy/rich-clipboard.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/schedule-format.test.ts` | `web/src/schedules/schedule-format.test.ts` | domain prefix schedule- | 已覆盖 |
| `web/src/utils/schedule-format.ts` | `web/src/schedules/schedule-format.ts` | domain prefix schedule- | 已覆盖 |
| `web/src/utils/setup-commands.test.ts` | `web/src/app/setup-commands.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/setup-commands.ts` | `web/src/app/setup-commands.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/setup-guide-storage.ts` | `web/src/app/setup-guide-storage.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/shorten-path.test.ts` | `web/src/lib/shorten-path.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/shorten-path.ts` | `web/src/lib/shorten-path.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/sidebar-agent-state.test.ts` | `web/src/sidebar/agent-state.test.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/sidebar-agent-state.ts` | `web/src/sidebar/agent-state.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/sidebar-project-row-model.test.ts` | `web/src/sidebar/project-row-model.test.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/sidebar-project-row-model.ts` | `web/src/sidebar/project-row-model.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/sidebar-reorder.test.ts` | `web/src/sidebar/reorder.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/sidebar-reorder.ts` | `web/src/sidebar/reorder.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/sidebar-shortcuts.test.ts` | `web/src/sidebar/shortcuts.test.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/sidebar-shortcuts.ts` | `web/src/sidebar/shortcuts.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/sidebar-sort-projects.test.ts` | `web/src/sidebar/sort-projects.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/sidebar-sort-projects.ts` | `web/src/sidebar/sort-projects.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/sidebar-workspace-archive-redirect.ts` | `web/src/sidebar/workspace-archive-redirect.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/split-markdown-blocks.ts` | `web/src/panels/split-markdown-blocks.ts` | domain prefix split- | 已覆盖 |
| `web/src/utils/split-navigation.test.ts` | `web/src/screens/split-navigation.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/split-navigation.ts` | `web/src/screens/split-navigation.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/status-loader.test.ts` | `web/src/sidebar/status-loader.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/status-loader.ts` | `web/src/sidebar/status-loader.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/terminal-keys.test.ts` | `web/src/terminal/keys.test.ts` | domain prefix terminal- | 已覆盖 |
| `web/src/utils/terminal-keys.ts` | `web/src/terminal/keys.ts` | domain prefix terminal- | 已覆盖 |
| `web/src/utils/terminal-list.test.ts` | `web/src/screens/terminal-list.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/terminal-list.ts` | `web/src/screens/terminal-list.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/terminal-renderer-readiness.test.ts` | `web/src/panels/terminal-renderer-readiness.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/terminal-renderer-readiness.ts` | `web/src/panels/terminal-renderer-readiness.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/time.test.ts` | `web/src/lib/time.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/time.ts` | `web/src/lib/time.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/tool-call-detail-state.test.ts` | `web/src/tool-calls/tool-call-detail-state.test.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/tool-call-detail-state.ts` | `web/src/tool-calls/tool-call-detail-state.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/tool-call-display.test.ts` | `web/src/tool-calls/tool-call-display.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/tool-call-display.ts` | `web/src/tool-calls/tool-call-display.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/tool-call-icon-name.test.ts` | `web/src/tool-calls/tool-call-icon-name.test.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/tool-call-icon-name.ts` | `web/src/tool-calls/tool-call-icon-name.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/tool-call-icon.ts` | `web/src/tool-calls/tool-call-icon.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/tool-call-parsers.test.ts` | `web/src/tool-calls/tool-call-parsers.test.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/tool-call-parsers.ts` | `web/src/tool-calls/tool-call-parsers.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/utils/version-display.ts` | `web/src/lib/version-display.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/wails.ts` | `web/src/platform/wails.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/web-focus.test.ts` | `web/src/platform/web-focus.test.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/web-focus.ts` | `web/src/platform/web-focus.ts` | judged: read the module | 已覆盖 |
| `web/src/utils/working-directory-suggestions.test.ts` | `web/src/app/working-directory-suggestions.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/working-directory-suggestions.ts` | `web/src/app/working-directory-suggestions.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/workspace-navigation.test.ts` | `web/src/app/workspace-navigation.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/workspace-navigation.ts` | `web/src/app/workspace-navigation.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/workspace-script-links.test.ts` | `web/src/screens/workspace-script-links.test.ts` | single feature consumer | 已覆盖 |
| `web/src/utils/workspace-script-links.ts` | `web/src/screens/workspace-script-links.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/feature-preferences.test.ts` | `web/src/agent-profiles/feature-preferences.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/feature-preferences.ts` | `web/src/agent-profiles/feature-preferences.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/image-attachment-picker.test.ts` | `web/src/composer/image-attachment-picker.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/image-attachment-picker.ts` | `web/src/composer/image-attachment-picker.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/keyboard-shift-policy.ts` | `web/src/app/keyboard-shift-policy.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/sidebar-status-view-model.test.ts` | `web/src/sidebar/status-view-model.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/sidebar-status-view-model.ts` | `web/src/sidebar/status-view-model.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/sidebar-workspaces-view-model.test.ts` | `web/src/sidebar/workspaces-view-model.test.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/hooks/sidebar-workspaces-view-model.ts` | `web/src/sidebar/workspaces-view-model.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/hooks/use-acp-provider-catalog.test.ts` | `web/src/screens/use-acp-provider-catalog.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-acp-provider-catalog.ts` | `web/src/screens/use-acp-provider-catalog.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-active-worktree-new-action.ts` | `web/src/app/use-active-worktree-new-action.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-agent-attention-clear.ts` | `web/src/panels/use-agent-attention-clear.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-agent-autocomplete.ts` | `web/src/composer/use-agent-autocomplete.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-agent-history.test.ts` | `web/src/screens/use-agent-history.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-agent-history.ts` | `web/src/screens/use-agent-history.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-agent-initialization.test.ts` | `web/src/contexts/use-agent-initialization.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-agent-initialization.ts` | `web/src/contexts/use-agent-initialization.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-autocomplete.ts` | `web/src/lib/use-autocomplete.ts` | judged: read the module | 已覆盖 |
| `web/src/hooks/use-branch-switcher.test.ts` | `web/src/git/use-branch-switcher.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-branch-switcher.ts` | `web/src/git/use-branch-switcher.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-client-activity.ts` | `web/src/contexts/use-client-activity.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-compact-web-viewport-zoom-lock.ts` | `web/src/platform/use-compact-web-viewport-zoom-lock.ts` | judged: read the module | 已覆盖 |
| `web/src/hooks/use-debounced-value.ts` | `web/src/lib/use-debounced-value.ts` | judged: read the module | 已覆盖 |
| `web/src/hooks/use-draft-agent-features.ts` | `web/src/composer/use-draft-agent-features.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-favicon-status.ts` | `web/src/app/use-favicon-status.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-fork-agent.ts` | `web/src/agent-stream/use-fork-agent.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-global-new-workspace-action.test.tsx` | `web/src/app/use-global-new-workspace-action.test.tsx` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-global-new-workspace-action.ts` | `web/src/app/use-global-new-workspace-action.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-global-workspace-pin-action.ts` | `web/src/app/use-global-workspace-pin-action.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-image-attachment-picker.ts` | `web/src/composer/use-image-attachment-picker.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-keyboard-shortcuts.ts` | `web/src/app/use-keyboard-shortcuts.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-load-older-agent-history.test.ts` | `web/src/agent-stream/use-load-older-agent-history.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-load-older-agent-history.ts` | `web/src/agent-stream/use-load-older-agent-history.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-preferred-editor.test.ts` | `web/src/workspace/use-preferred-editor.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-preferred-editor.ts` | `web/src/workspace/use-preferred-editor.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-schedule-mutations.test.ts` | `web/src/screens/use-schedule-mutations.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-schedule-mutations.ts` | `web/src/screens/use-schedule-mutations.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-schedules.test.ts` | `web/src/screens/use-schedules.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-schedules.ts` | `web/src/screens/use-schedules.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-show-shortcut-badges.ts` | `web/src/sidebar/use-show-shortcut-badges.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-stable-event.ts` | `web/src/lib/use-stable-event.ts` | judged: read the module | 已覆盖 |
| `web/src/hooks/use-tunnels.ts` | `web/src/screens/use-tunnels.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-workspace-read-state.test.ts` | `web/src/sidebar/use-workspace-read-state.test.ts` | single feature consumer | 已覆盖 |
| `web/src/hooks/use-workspace-read-state.ts` | `web/src/sidebar/use-workspace-read-state.ts` | single feature consumer | 已覆盖 |
| `web/src/components/adaptive-modal-sheet.tsx` | `web/src/widgets/adaptive-modal-sheet.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/add-host-method-modal.tsx` | `web/src/screens/add-host-method-modal.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/add-project-flow-host.tsx` | `web/src/app/add-project-flow-host.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/add-project-flow.tsx` | `web/src/app/add-project-flow.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/agent-list.tsx` | `web/src/screens/agent-list.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/agent-status-dot.tsx` | `web/src/widgets/agent-status-dot.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/app-diagnostic-host.tsx` | `web/src/app/diagnostic-host.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/app-diagnostic-sheet.tsx` | `web/src/app/diagnostic-sheet.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/archived-agent-callout.tsx` | `web/src/panels/archived-agent-callout.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/branch-switcher.tsx` | `web/src/git/branch-switcher.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/code-insets.ts` | `web/src/git/code-insets.ts` | single feature consumer | 已覆盖 |
| `web/src/components/community-links.tsx` | `web/src/screens/community-links.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/compact-explorer-sidebar-host-state.test.ts` | `web/src/app/compact-explorer-sidebar-host-state.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/compact-explorer-sidebar-host-state.ts` | `web/src/app/compact-explorer-sidebar-host-state.ts` | single feature consumer | 已覆盖 |
| `web/src/components/compact-explorer-sidebar-host.tsx` | `web/src/app/compact-explorer-sidebar-host.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/compact-explorer-sidebar.tsx` | `web/src/app/compact-explorer-sidebar.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/context-window-meter.tsx` | `web/src/composer/context-window-meter.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/context-window-meter.utils.ts` | `web/src/composer/context-window-meter.utils.ts` | single feature consumer | 已覆盖 |
| `web/src/components/desktop-sidebar-layout.test.ts` | `web/src/app/desktop-sidebar-layout.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/desktop-sidebar-layout.ts` | `web/src/app/desktop-sidebar-layout.ts` | single feature consumer | 已覆盖 |
| `web/src/components/diff-stat.tsx` | `web/src/widgets/diff-stat.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/diff-viewer.tsx` | `web/src/git/diff-viewer.tsx` | domain prefix diff- | 已覆盖 |
| `web/src/components/download-toast.tsx` | `web/src/app/download-toast.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/draggable-list.types.ts` | `web/src/widgets/draggable-list.types.ts` | judged: read the module | 已覆盖 |
| `web/src/components/file-change-icon.tsx` | `web/src/git/file-change-icon.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/file-icon-svg.test.ts` | `web/src/widgets/file-icon-svg.test.ts` | judged: read the module | 已覆盖 |
| `web/src/components/file-icon-svg.ts` | `web/src/widgets/file-icon-svg.ts` | judged: read the module | 已覆盖 |
| `web/src/components/file-pane-enabled.test.ts` | `web/src/file-pane/enabled.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/file-pane-enabled.ts` | `web/src/file-pane/enabled.ts` | single feature consumer | 已覆盖 |
| `web/src/components/file-pane-render-mode.test.ts` | `web/src/file-pane/render-mode.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/file-pane-render-mode.ts` | `web/src/file-pane/render-mode.ts` | single feature consumer | 已覆盖 |
| `web/src/components/highlighted-code-block.tsx` | `web/src/widgets/highlighted-code-block.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/highlighted-content.tsx` | `web/src/widgets/highlighted-content.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/host-route-bootstrap-boundary.tsx` | `web/src/app/host-route-bootstrap-boundary.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/host-status-dot.tsx` | `web/src/widgets/host-status-dot.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/info-hover-card.tsx` | `web/src/widgets/info-hover-card.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/keyboard-shortcuts-dialog.tsx` | `web/src/app/keyboard-shortcuts-dialog.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/keyboard-translate-view.tsx` | `web/src/keyboard/translate-view.tsx` | domain prefix keyboard- | 已覆盖 |
| `web/src/components/material-file-icon.tsx` | `web/src/widgets/material-file-icon.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/material-file-icons.ts` | `web/src/widgets/material-file-icons.ts` | judged: read the module | 已覆盖 |
| `web/src/components/menu-kit.tsx` | `web/src/widgets/menu-kit.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/message.tsx` | `web/src/agent-stream/message.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/project-edit-sheet.tsx` | `web/src/screens/project-edit-sheet.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/project-picker-options.test.ts` | `web/src/app/project-picker-options.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/project-picker-options.ts` | `web/src/app/project-picker-options.ts` | single feature consumer | 已覆盖 |
| `web/src/components/provider-catalog-list.tsx` | `web/src/screens/provider-catalog-list.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/provider-diagnostic-models.test.ts` | `web/src/app/provider-diagnostic-models.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/provider-diagnostic-models.ts` | `web/src/app/provider-diagnostic-models.ts` | single feature consumer | 已覆盖 |
| `web/src/components/provider-diagnostic-sheet.tsx` | `web/src/app/provider-diagnostic-sheet.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/provider-icons.test.ts` | `web/src/widgets/provider-icons.test.ts` | judged: read the module | 已覆盖 |
| `web/src/components/provider-icons.ts` | `web/src/widgets/provider-icons.ts` | judged: read the module | 已覆盖 |
| `web/src/components/provider-settings-host.tsx` | `web/src/app/provider-settings-host.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/provider-terminal-integration.tsx` | `web/src/app/provider-terminal-integration.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/provider-terminal-profile-save.test.ts` | `web/src/app/provider-terminal-profile-save.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/provider-terminal-profile-save.ts` | `web/src/app/provider-terminal-profile-save.ts` | single feature consumer | 已覆盖 |
| `web/src/components/question-form-card-core.test.ts` | `web/src/agent-stream/question-form-card-core.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/question-form-card-core.ts` | `web/src/agent-stream/question-form-card-core.ts` | single feature consumer | 已覆盖 |
| `web/src/components/question-form-card.tsx` | `web/src/agent-stream/question-form-card.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/resize-handle-sizes.test.ts` | `web/src/widgets/resize-handle-sizes.test.ts` | judged: read the module | 已覆盖 |
| `web/src/components/resize-handle-sizes.ts` | `web/src/widgets/resize-handle-sizes.ts` | judged: read the module | 已覆盖 |
| `web/src/components/retained-panel.tsx` | `web/src/widgets/retained-panel.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/root-error-details.test.ts` | `web/src/app/root-error-details.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/root-error-details.ts` | `web/src/app/root-error-details.ts` | single feature consumer | 已覆盖 |
| `web/src/components/settings-textarea.tsx` | `web/src/widgets/settings-textarea.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/setup-guide-modal.tsx` | `web/src/app/setup-guide-modal.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/shortcut.tsx` | `web/src/widgets/shortcut.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/sidebar-callout.test.tsx` | `web/src/contexts/sidebar-callout.test.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/sidebar-callout.tsx` | `web/src/contexts/sidebar-callout.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/sidebar-workspace-list.test.tsx` | `web/src/sidebar/workspace-list.test.tsx` | domain prefix sidebar- | 已覆盖 |
| `web/src/components/sortable-inline-list.tsx` | `web/src/widgets/sortable-inline-list.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/sortable-list.tsx` | `web/src/widgets/sortable-list.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/split-container-focus.test.ts` | `web/src/screens/split-container-focus.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/split-container-focus.ts` | `web/src/screens/split-container-focus.ts` | single feature consumer | 已覆盖 |
| `web/src/components/split-container-pane-focus.test.ts` | `web/src/screens/split-container-pane-focus.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/split-container-pane-focus.ts` | `web/src/screens/split-container-pane-focus.ts` | single feature consumer | 已覆盖 |
| `web/src/components/split-container-tab-drop-preview.test.ts` | `web/src/screens/split-container-tab-drop-preview.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/split-container-tab-drop-preview.ts` | `web/src/screens/split-container-tab-drop-preview.ts` | single feature consumer | 已覆盖 |
| `web/src/components/split-container.tsx` | `web/src/screens/split-container.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/split-drop-zone.tsx` | `web/src/screens/split-drop-zone.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/status-ring.tsx` | `web/src/widgets/status-ring.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/terminal-copy-paste-actions.tsx` | `web/src/panels/terminal-copy-paste-actions.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/terminal-emulator.tsx` | `web/src/panels/terminal-emulator.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/terminal-pane-focus-claim.test.ts` | `web/src/panels/terminal-pane-focus-claim.test.ts` | single feature consumer | 已覆盖 |
| `web/src/components/terminal-pane-focus-claim.ts` | `web/src/panels/terminal-pane-focus-claim.ts` | single feature consumer | 已覆盖 |
| `web/src/components/terminal-pane.tsx` | `web/src/panels/terminal-pane.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/terminal-profile-icon.tsx` | `web/src/terminal/profile-icon.tsx` | domain prefix terminal- | 已覆盖 |
| `web/src/components/toast-host.tsx` | `web/src/widgets/toast-host.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/tool-call-details.tsx` | `web/src/tool-calls/tool-call-details.tsx` | domain prefix tool-call- | 已覆盖 |
| `web/src/components/tool-call-sheet.tsx` | `web/src/tool-calls/tool-call-sheet.tsx` | domain prefix tool-call- | 已覆盖 |
| `web/src/components/tool-call-subagent-row.ts` | `web/src/tool-calls/tool-call-subagent-row.ts` | domain prefix tool-call- | 已覆盖 |
| `web/src/components/tree-primitives.tsx` | `web/src/widgets/tree-primitives.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/tree-rail-toggle.tsx` | `web/src/git/tree-rail-toggle.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/tree-rail.tsx` | `web/src/git/tree-rail.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/welcome-screen.tsx` | `web/src/app/welcome-screen.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/with-tooltip.tsx` | `web/src/widgets/with-tooltip.tsx` | judged: read the module | 已覆盖 |
| `web/src/components/workspace-pin-shortcut-handler.tsx` | `web/src/app/workspace-pin-shortcut-handler.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/workspace-rename-host.tsx` | `web/src/app/workspace-rename-host.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/workspace-shortcut-targets-subscriber.test.tsx` | `web/src/app/workspace-shortcut-targets-subscriber.test.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/workspace-shortcut-targets-subscriber.tsx` | `web/src/app/workspace-shortcut-targets-subscriber.tsx` | single feature consumer | 已覆盖 |
| `web/src/components/worktree-setup-callout-source.tsx` | `web/src/app/worktree-setup-callout-source.tsx` | single feature consumer | 已覆盖 |
| `web/src/stores/explorer-checkout-context.ts` | `web/src/file-explorer/explorer-checkout-context.ts` | domain prefix explorer- | 已覆盖 |
| `web/src/stores/explorer-tab-memory.ts` | `web/src/file-explorer/explorer-tab-memory.ts` | domain prefix explorer- | 已覆盖 |
| `web/src/stores/keyboard-shortcuts-store.test.ts` | `web/src/keyboard/shortcuts-store.test.ts` | domain prefix keyboard- | 已覆盖 |
| `web/src/stores/keyboard-shortcuts-store.ts` | `web/src/keyboard/shortcuts-store.ts` | domain prefix keyboard- | 已覆盖 |
| `web/src/stores/sidebar-order-store.test.ts` | `web/src/sidebar/order-store.test.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/stores/sidebar-order-store.ts` | `web/src/sidebar/order-store.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/stores/sidebar-view-store.test.ts` | `web/src/sidebar/view-store.test.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/stores/sidebar-view-store.ts` | `web/src/sidebar/view-store.ts` | domain prefix sidebar- | 已覆盖 |
| `web/src/utils/agent-directory-sync` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/agent-directory-sync` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/agent-grouping` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/agent-grouping` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/agent-initialization` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/agent-snapshots` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/agent-snapshots` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/app-version` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/assistant-image-metadata` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/assistant-image-metadata` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/assistant-image-source` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/assistant-image-source` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/assistant-markdown-parser` | `web/src/agent-stream/markdown-parser` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/assistant-markdown-parser` | `web/src/agent-stream/markdown-parser` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/assistant-message-height-estimate` | `web/src/agent-stream/message-height-estimate` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/assistant-message-height-estimate` | `web/src/agent-stream/message-height-estimate` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/client-id` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/client-id` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/command-center-focus-restore` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/confirm-dialog` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/confirm-dialog` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/daemon-endpoints` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/daemons` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/desktop-badge-state` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/desktop-badge-state` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/format-shortcut` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/format-shortcut` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/highlight-cache` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/highlight-cache` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/host-routes` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/host-routes` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/pair-offer` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/prepare-workspace-tab` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/project-display-name` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/project-display-name` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/project-placement` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/project-placement` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/projects` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/projects` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/provider-definitions` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/provider-notice-toast` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/shortcut-platform` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/ssh-target-input` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/ssh-target-input` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/test-daemon-connection` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/test-daemon-connection` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/to-xterm-theme` | `web/src/appearance/xterm-theme` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/workspace-agent-activity` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/workspace-agent-activity` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/workspace-archive-navigation` | `web/src/sidebar/archive-navigation` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/workspace-archive-navigation` | `web/src/sidebar/archive-navigation` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/workspace-archive-redirect` | `web/src/sidebar/archive-redirect` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/utils/workspace-directory` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/workspace-directory` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/workspace-identity` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/utils/workspace-identity` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/agent-commands-query` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/agent-commands-query` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/agent-history-query-key` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/client-activity-tracker` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/client-activity-tracker` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/open-project` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-agent-commands-query` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-agent-commands-query` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-agent-form-state` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-agent-screen-state-machine` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-agent-screen-state-machine` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-aggregated-agents` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-app-visible` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-archive-agent` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-archive-agent` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-compact-time-ago` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-daemon-config` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-file-download` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-file-explorer-actions` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-file-picker` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-form-preferences` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-form-preferences` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-import-session` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-is-local-daemon` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-is-local-daemon` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-keyboard-action-handler` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-keyboard-shift-style` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-keyboard-shortcut-overrides` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-open-add-project` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-open-project` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-open-project` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-projects` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-projects` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-providers-snapshot` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-providers-snapshot` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-revealed-text` | `web/src/agent-stream/use-revealed-text` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/hooks/use-shortcut-keys` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-sidebar-pins` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-sidebar-pins` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-sidebar-workspace-entries` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-sidebar-workspace-entries` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-sidebar-workspace-pin` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-sidebar-workspaces-list` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/hooks/use-workspace-clipboard-actions` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/add-host-modal` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/add-remote-ssh-host-modal` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/assistant-fork-menu` | `web/src/agent-stream/fork-menu` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/assistant-message-render-limit` | `web/src/agent-stream/message-render-limit` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/assistant-message-render-limit` | `web/src/agent-stream/message-render-limit` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/attachment-lightbox` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/attachment-lightbox` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/combined-model-selector` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/file-actions-menu` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/file-explorer-pane` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/import-session-sheet-view-model` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/import-session-sheet-view-model` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/import-session-sheet` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/import-session-sheet` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/info-hover-card.browser` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/message-compaction-label` | `web/src/agent-stream/compaction-label` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/message-compaction-label` | `web/src/agent-stream/compaction-label` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/message-notification-parser` | `web/src/agent-stream/notification-parser` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/message-notification-parser` | `web/src/agent-stream/notification-parser` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/message.tool-call-subagent` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/model-browser-view` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/model-browser-view` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/model-browser` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/pair-link-modal` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/plan-card` | `web/src/agent-stream/plan-card` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/project-icon-view` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/provider-icon-name` | `web/src/data/provider-icon-name` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/provider-icon-name` | `web/src/data/provider-icon-name` | 单一功能归属（补漏轮） | 已覆盖 |
| `web/src/components/rename-modal` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/rename-modal` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/task-list-row` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/workspace-rename-modal` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/worktree-setup-callout-policy` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/components/worktree-setup-callout-policy` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/add-project-flow-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/create-flow-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/create-flow-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/download-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/draft-keys` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/draft-keys` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/last-workspace-selection` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/last-workspace-selection` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/provider-settings-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/provider-settings-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/session-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/session-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-draft-submission-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-layout-actions` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-layout-constants` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-layout-ids` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-layout-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-layout-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-setup-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-setup-store` | 留在共享桶 | cross-domain, stays shared | 不适用 |
| `web/src/stores/workspace-subagents-integration` | 留在共享桶 | cross-domain, stays shared | 不适用 |
