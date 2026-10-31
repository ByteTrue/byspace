// Override of packages/app/src/components/task-list-row.tsx: one task with its status mark.
import { memo } from "react";
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import type { TodoEntry } from "@/types/stream";
import { cn } from "cn";

function TaskStatusIcon({ isCompleted, isRunning }: { isCompleted: boolean; isRunning: boolean }) {
  if (isCompleted) return <CircleCheck size={16} className="shrink-0 text-ring" />;
  if (isRunning) return <CircleDot size={16} className="shrink-0 text-status-dot-running" />;
  // A pending task's ring is a status mark, not a checkbox. At the muted step it carries the
  // weight of an enabled control and invites a click that does nothing, so it sits one step back
  // from the text it marks.
  return <Circle size={16} className="shrink-0 text-ring" />;
}

export const TaskListRow = memo(function TaskListRow({ task }: { task: TodoEntry }) {
  const isCompleted = task.completed || task.status === "completed";
  const isRunning = !isCompleted && task.status === "in_progress";
  const text = isRunning && task.activeForm ? task.activeForm : task.text;
  return (
    <div className="flex items-center gap-2" aria-label={text}>
      <TaskStatusIcon isCompleted={isCompleted} isRunning={isRunning} />
      {/* Grows and shrinks with an auto basis: a container sized to its content measures it. */}
      <span
        className={cn(
          "min-w-0 shrink grow basis-auto truncate text-sm",
          isRunning && "text-foreground",
          isCompleted && "text-ring line-through",
          !isRunning && !isCompleted && "text-muted-foreground",
        )}
      >
        {text}
      </span>
    </div>
  );
});
