export {
  AssistantInlineCodePathLink,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
} from "@/assistant-file-links/link";
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
