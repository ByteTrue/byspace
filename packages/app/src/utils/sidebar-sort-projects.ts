import { isHomeProjectViewKey } from "@/chief/home-workspace";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";

export type ProjectSortTier = 1 | 2 | 3;

/**
 * 分类规则：
 * 1. 顶部（Tier 1）：拥有活跃 workspace（如运行中 running、待查看 attention、等待输入 needs_input、出错 failed 等非 done 状态）。
 * 2. 中间（Tier 2）：拥有 workspace，但全部为已完成/空闲状态（全部为 done）。
 * 3. 底部（Tier 3）：没有任何 workspace 的项目。
 */
export function getProjectSortTier(
  project: SidebarProjectEntry,
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
): ProjectSortTier {
  if (project.workspaces.length === 0) {
    return 3;
  }

  const hasActiveWorkspace = project.workspaces.some((workspace) => {
    const entry = workspaceEntriesByKey.get(workspace.workspaceKey);
    return Boolean(entry && entry.statusBucket !== "done");
  });

  return hasActiveWorkspace ? 1 : 2;
}

/**
 * 按用户规则重排项目：
 * 1. Tier 1（活跃）在最前，Tier 2（有 workspace）在中，Tier 3（无 workspace）在后；
 * 2. 同一大类内部按项目名称首字母升序排序（localeCompare，支持数字自然序与大小写不敏感）；
 * 3. 名称相同则按 viewKey 确定唯一顺序。
 *
 * 固定首位的 Chief 项目不参与：它的位置由版面固定，排序按钮作用于用户自己的项目。
 */
export function sortProjectsByRules(
  projects: readonly SidebarProjectEntry[],
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
): SidebarProjectEntry[] {
  const fixed: SidebarProjectEntry[] = [];
  const sortable: SidebarProjectEntry[] = [];
  for (const project of projects) {
    // Pinned to the head of the returned order rather than dropped: this order is what the
    // caller persists as the project order, and dropping it would save a file where the Chief
    // project's slot is claimed by whatever lands first.
    (isHomeProjectViewKey(project.viewKey) ? fixed : sortable).push(project);
  }
  return [
    ...fixed,
    ...sortable.sort((a, b) => {
      const tierA = getProjectSortTier(a, workspaceEntriesByKey);
      const tierB = getProjectSortTier(b, workspaceEntriesByKey);
      if (tierA !== tierB) {
        return tierA - tierB;
      }
      const nameDiff = a.projectName.localeCompare(b.projectName, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (nameDiff !== 0) {
        return nameDiff;
      }
      return a.viewKey.localeCompare(b.viewKey);
    }),
  ];
}
