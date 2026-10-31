// Override of packages/app/src/composer/task-list/index.tsx: the agent's task list as a "2/7 tasks"
// pill above the composer; its panel lists every task in place.
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TaskListRow } from "@/components/task-list-row";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import type { TodoEntry } from "@/types/stream";

export const AgentTaskList = memo(function AgentTaskList({
  tasks,
}: {
  tasks: TodoEntry[] | undefined;
}) {
  if (!tasks?.length) return null;
  return <TaskListCard tasks={tasks} />;
});

const TaskListCard = memo(function TaskListCard({ tasks }: { tasks: TodoEntry[] }) {
  const { t } = useTranslation();
  const completed = useMemo(
    () => tasks.filter((task) => task.completed || task.status === "completed").length,
    [tasks],
  );
  // Counts only; the panel shows the active task in full, in place.
  const label = t("message.todo.tasksProgress", { completed, total: tasks.length });
  const segments = useMemo(() => [{ bucket: null, text: label }], [label]);
  return (
    <ComposerTrackPill
      testID="agent-task-list-header"
      segments={segments}
      panelTitle={t("message.todo.title")}
    >
      {tasks.map((task, index) => (
        <ComposerTrackRow key={task.id ?? `${index}:${task.text}`}>
          <div className="min-w-0 shrink grow basis-auto">
            <TaskListRow task={task} />
          </div>
        </ComposerTrackRow>
      ))}
    </ComposerTrackPill>
  );
});
