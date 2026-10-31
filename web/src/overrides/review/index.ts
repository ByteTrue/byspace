// Override of packages/app/src/review/index.ts.
// shortcut: the inline review surface (packages/app/src/review/surface.tsx, React Native) moves
// with the diff views in batch 6 of step 3; until then this barrel exports the store and geometry
// only, which is all the web build reaches.
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
