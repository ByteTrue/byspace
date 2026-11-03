// Port of packages/app/src/review/index.ts: the same exports, through `@/` so the web surface
// (review/surface.tsx) replaces the Expo one.
export {
  buildReviewAttachmentSnapshot,
  buildReviewDraftKey,
  getReviewDraftComments,
  resetReviewDraftStore,
  useClearReviewDraft,
  useReviewAttachmentSnapshot,
  addReviewDraftComment,
  type BuildReviewDraftKeyInput,
  type ReviewDraftCommentInput,
  type ReviewDraftComment,
  type ReviewDraftMode,
  type ReviewDraftSide,
} from "@/review/store";

export {
  getInlineReviewThreadState,
  getSplitInlineReviewThreadState,
  isInlineReviewEditorForTarget,
  type InlineReviewActions,
  type InlineReviewEditorState,
} from "@/review/geometry";

export {
  getInlineReviewThreadViewportStyle,
  groupInlineReviewCommentsByTarget,
  InlineReviewAddButton,
  InlineReviewEditor,
  InlineReviewThread,
  SMALL_ACTION_HIT_SLOP,
  useInlineReviewController,
} from "@/review/surface";
