# shadcn/ui 参照快照

UI 美化 Epic（`byissue/epics/2026-10-31-o-ui-style-refresh/`）的唯一组件参照。样板页和后续实现里的数值都从这里抄，不凭印象。

- 上游：<https://github.com/shadcn-ui/ui>
- 版本：commit `b8d7baa15b1dca5716f13153e63795fc3d741f6b`（2026-10-30）
- 许可：MIT，见 `LICENSE.md`

| 路径 | 上游位置 | 用途 |
|---|---|---|
| `themes.ts` | `apps/v4/registry/themes.ts` | 底色主题（neutral、zinc、stone 等）的浅色深色变量，oklch |
| `globals.css` | `apps/v4/app/globals.css` | 变量到 Tailwind 的映射，圆角阶梯（`--radius-sm/md/lg/xl` 由 `--radius` 推出） |
| `styles/style-*.css` | `apps/v4/registry/styles/` | 八种风格（vega、nova、mira、rhea、luma、maia、lyra、sera）各自给 `cn-*` 类的样式 |
| `radix-ui/` | `apps/v4/registry/bases/radix/ui/` | 套用这些风格的组件结构（`cn-*` 类挂在哪个元素上） |
| `new-york-v4-ui/` | `apps/v4/registry/new-york-v4/ui/` | 经典版组件，类名直接写在组件里 |

这些文件只做对照，不参与构建；更新时整体换成新的上游版本并改上面的 commit。
