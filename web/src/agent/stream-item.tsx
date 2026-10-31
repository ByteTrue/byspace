import { memo } from "react";
import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";
import {
  buildToolCallPresentation,
  type ToolCallPresentationIcon,
} from "@/tool-calls/presentation";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { resolveToolCallIconName } from "@/utils/tool-call-icon-name";
import {
  Bot,
  Brain,
  CircleAlert,
  Eye,
  MicVocal,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { Markdown } from "~/agent/markdown";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Message, MessageContent } from "~/components/ui/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "~/components/ui/trace";

const TOOL_ICONS: Record<ReturnType<typeof resolveToolCallIconName>, ToolCallPresentationIcon> = {
  wrench: Wrench,
  square_terminal: SquareTerminal,
  eye: Eye,
  pencil: Pencil,
  search: Search,
  bot: Bot,
  sparkles: Sparkles,
  brain: Brain,
  mic_vocal: MicVocal,
  byspace: Sparkles,
};

function resolveToolIcon(toolName: string, detail?: ToolCallDetail): ToolCallPresentationIcon {
  return TOOL_ICONS[resolveToolCallIconName(toolName, detail)];
}

function ToolCallView({ item, cwd }: { item: ToolCallItem; cwd?: string }) {
  const payload = item.payload;
  const toolName = payload.source === "agent" ? payload.data.name : payload.data.toolName;
  const status = payload.data.status;
  const error = payload.data.error ?? null;
  const detail = payload.source === "agent" ? payload.data.detail : undefined;
  const presentation = buildToolCallPresentation({
    toolName,
    status,
    error,
    detail,
    metadata: payload.source === "agent" ? payload.data.metadata : undefined,
    cwd,
    resolveIcon: resolveToolIcon,
  });
  const Icon = presentation.icon;
  let traceStatus: "running" | "error" | undefined;
  if (status === "running" || status === "executing") traceStatus = "running";
  else if (presentation.errorText) traceStatus = "error";
  const line = (
    <TraceLine status={traceStatus} className="gap-2">
      <TraceIcon>
        <Icon size={16} />
      </TraceIcon>
      <TraceTitle className="font-medium text-foreground">{presentation.displayName}</TraceTitle>
      {presentation.summary ? (
        <TraceDescription className="truncate">{presentation.summary}</TraceDescription>
      ) : null}
    </TraceLine>
  );
  if (!presentation.hasDetails) return <Trace>{line}</Trace>;
  // shortcut: details render as raw JSON; the per-type detail views (diff, shell output, ...)
  // come with step 3 of the rewrite epic.
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          {presentation.errorText ? (
            <p className="mb-2 text-destructive-text">{presentation.errorText}</p>
          ) : null}
          <pre className="max-h-80 overflow-auto font-mono text-xs leading-relaxed">
            {JSON.stringify(detail ?? payload.data, null, 2)}
          </pre>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export const StreamItemView = memo(function StreamItemView({
  item,
  cwd,
}: {
  item: StreamItem;
  cwd?: string;
}) {
  switch (item.kind) {
    case "user_message":
      return (
        <Message align="end">
          <MessageContent>
            <Bubble variant="secondary">
              <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      );
    case "assistant_message":
      return (
        <Message>
          <MessageContent>
            <Markdown text={item.text} />
          </MessageContent>
        </Message>
      );
    case "thought":
      return (
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine
                status={item.status === "loading" ? "running" : undefined}
                className="gap-2"
              >
                <TraceIcon>
                  <Brain className="size-4" />
                </TraceIcon>
                <TraceTitle>Thinking</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <Markdown text={item.text} className="text-muted-foreground" />
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      );
    case "tool_call":
      return <ToolCallView item={item} cwd={cwd} />;
    case "notification":
      return (
        <p
          className={
            item.level === "error"
              ? "flex items-center gap-2 text-sm text-destructive-text"
              : "flex items-center gap-2 text-sm text-muted-foreground"
          }
        >
          {item.level === "error" ? <CircleAlert className="size-4 shrink-0" /> : null}
          {item.message}
        </p>
      );
    case "todo_list":
      return (
        <ul className="flex flex-col gap-1 text-sm">
          {item.items.map((todo) => (
            <li
              key={todo.id ?? todo.text}
              className={todo.completed ? "text-muted-foreground line-through" : undefined}
            >
              {todo.text}
            </li>
          ))}
        </ul>
      );
    case "compaction":
      return (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          Context compacted
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "custom_message":
    case "plugin":
      return (
        <p className="text-sm text-muted-foreground">{"text" in item ? String(item.text) : null}</p>
      );
  }
});
