// Override of packages/app/src/assistant-file-links/index.ts: the same barrel through `@/`, so the
// web link components apply (overrides only replace `@/` imports).
export {
  AssistantInlineCodePathLink,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
} from "@/assistant-file-links/link";
export {
  type AssistantLinkPress,
  useAssistantLinkPress,
} from "@/assistant-file-links/link-press-context";
export {
  classifyAssistantFileLink,
  normalizeInlinePathTarget,
  type InlinePathTarget,
} from "@/assistant-file-links/parse";
export {
  AssistantFileLinkResolverProvider,
  type AssistantFileLinkResolverProviderProps,
} from "@/assistant-file-links/provider";
export type { AssistantFileLinkSource } from "@/assistant-file-links/resolver";
export { useAssistantFileLinkActions } from "@/assistant-file-links/use-file-link";
