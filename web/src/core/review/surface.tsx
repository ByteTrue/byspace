// Port of archive/expo-app:packages/app/src/review/surface.tsx: inline review comments on a diff line — the "+"
// affordance, the thread of draft comments under the line, and the comment editor (⌘/Ctrl+Enter
// saves, Escape cancels). The draft store and the controller are the Expo file's; the view is DOM.
// InlineReviewGutterCell is not ported: the canvas diff draws its own gutter and uses
// InlineReviewAddButton.
import { Item, ItemActions, ItemContent, ItemDescription } from "~/components/ui/item";
import { Textarea } from "~/components/ui/textarea";
import { Card } from "~/components/ui/card";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  useReviewDraftComments,
  useReviewDraftStore,
  type ReviewDraftComment,
} from "@/review/store";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  INLINE_REVIEW_EDITOR_HEIGHT,
  INLINE_REVIEW_GAP,
  INLINE_REVIEW_VERTICAL_PADDING,
  isInlineReviewEditorForTarget,
  type InlineReviewActions,
  type InlineReviewEditorState,
} from "@/review/geometry";

export const SMALL_ACTION_HIT_SLOP = 8;

export function InlineReviewAddButton({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: CSSProperties | object;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="icon-xs"
      type="button"
      aria-label={t("review.comment.add")}
      onClick={onPress}
      style={style as CSSProperties}
      className="z-10"
    >
      <Plus size={16} strokeWidth={2.4} />
    </Button>
  );
}

export function groupInlineReviewCommentsByTarget(
  comments: readonly ReviewDraftComment[],
): Map<string, ReviewDraftComment[]> {
  const grouped = new Map<string, ReviewDraftComment[]>();
  for (const comment of comments) {
    const key = buildReviewableDiffTargetKey(comment);
    grouped.set(key, [...(grouped.get(key) ?? []), comment]);
  }
  return grouped;
}

export function useInlineReviewController(input: { reviewDraftKey: string }): InlineReviewActions {
  const reviewComments = useReviewDraftComments(input.reviewDraftKey);
  const commentsByTarget = useMemo(
    () => groupInlineReviewCommentsByTarget(reviewComments),
    [reviewComments],
  );
  const [editor, setEditor] = useState<InlineReviewEditorState | null>(null);
  const addComment = useReviewDraftStore((state) => state.addComment);
  const updateComment = useReviewDraftStore((state) => state.updateComment);
  const deleteComment = useReviewDraftStore((state) => state.deleteComment);

  useEffect(() => {
    setEditor(null);
  }, [input.reviewDraftKey]);

  const handleStartComment = useCallback((target: ReviewableDiffTarget) => {
    setEditor({ target, commentId: null, body: "" });
  }, []);

  const handleEditComment = useCallback(
    (target: ReviewableDiffTarget, comment: ReviewDraftComment) => {
      setEditor({ target, commentId: comment.id, body: comment.body });
    },
    [],
  );

  const handleCancelEditor = useCallback(() => {
    setEditor(null);
  }, []);

  const handleSaveEditor = useCallback(
    (body: string) => {
      const trimmedBody = body.trim();
      if (!editor || trimmedBody.length === 0) {
        return;
      }

      if (editor.commentId) {
        updateComment({
          key: input.reviewDraftKey,
          id: editor.commentId,
          updates: { body: trimmedBody },
        });
      } else {
        addComment({
          key: input.reviewDraftKey,
          comment: {
            filePath: editor.target.filePath,
            side: editor.target.side,
            lineNumber: editor.target.lineNumber,
            body: trimmedBody,
          },
        });
      }
      setEditor(null);
    },
    [addComment, editor, input.reviewDraftKey, updateComment],
  );

  const handleDeleteComment = useCallback(
    (id: string) => {
      deleteComment({ key: input.reviewDraftKey, id });
      setEditor((current) => (current?.commentId === id ? null : current));
    },
    [deleteComment, input.reviewDraftKey],
  );

  return useMemo<InlineReviewActions>(
    () => ({
      commentsByTarget,
      editor,
      onStartComment: handleStartComment,
      onEditComment: handleEditComment,
      onCancelEditor: handleCancelEditor,
      onSaveEditor: handleSaveEditor,
      onDeleteComment: handleDeleteComment,
    }),
    [
      commentsByTarget,
      editor,
      handleCancelEditor,
      handleDeleteComment,
      handleEditComment,
      handleSaveEditor,
      handleStartComment,
    ],
  );
}

export function InlineReviewThread({
  reviewTarget,
  reviewActions,
  height,
  viewportWidth,
  pinToViewport = false,
  testID,
}: {
  reviewTarget: ReviewableDiffTarget;
  reviewActions: InlineReviewActions;
  height: number;
  viewportWidth?: number;
  pinToViewport?: boolean;
  testID?: string;
}) {
  const comments = reviewActions.commentsByTarget.get(reviewTarget.key) ?? [];
  const editor = isInlineReviewEditorForTarget(reviewActions.editor, reviewTarget)
    ? reviewActions.editor
    : null;
  const editingCommentId = editor?.commentId ?? null;
  const editingExisting =
    editingCommentId !== null && comments.some((comment) => comment.id === editingCommentId);

  const editorElement = editor ? (
    <InlineReviewEditor
      key={editingCommentId ?? "new"}
      initialBody={editor.body}
      onCancel={reviewActions.onCancelEditor}
      onSave={reviewActions.onSaveEditor}
      testID="inline-review-editor"
    />
  ) : null;

  const containerStyle = useMemo<CSSProperties>(
    () => ({
      ...getInlineReviewThreadViewportStyle({ viewportWidth, pinToViewport }),
      minHeight: height,
      gap: INLINE_REVIEW_GAP,
      paddingTop: INLINE_REVIEW_VERTICAL_PADDING,
      paddingBottom: INLINE_REVIEW_VERTICAL_PADDING,
    }),
    [viewportWidth, pinToViewport, height],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col px-3" style={containerStyle} data-testid={testID}>
      {comments.map((comment) => {
        if (comment.id === editingCommentId) {
          return <Fragment key={comment.id}>{editorElement}</Fragment>;
        }
        return (
          <CommentRow
            key={comment.id}
            comment={comment}
            reviewTarget={reviewTarget}
            onEditComment={reviewActions.onEditComment}
            onDeleteComment={reviewActions.onDeleteComment}
          />
        );
      })}
      {editor && !editingExisting ? editorElement : null}
    </div>
  );
}

function CommentRow({
  comment,
  reviewTarget,
  onEditComment,
  onDeleteComment,
}: {
  comment: ReviewDraftComment;
  reviewTarget: ReviewableDiffTarget;
  onEditComment: (target: ReviewableDiffTarget, comment: ReviewDraftComment) => void;
  onDeleteComment: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleEdit = useCallback(
    () => onEditComment(reviewTarget, comment),
    [onEditComment, reviewTarget, comment],
  );
  const handleDelete = useCallback(
    () => onDeleteComment(comment.id),
    [onDeleteComment, comment.id],
  );

  return (
    <Item variant="muted" size="sm">
      <ItemContent className="min-w-0">
        <ItemDescription className="line-clamp-2 text-foreground">{comment.body}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={t("review.comment.edit")}
          data-testid={`review-comment-edit-${comment.id}`}
          onClick={handleEdit}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={t("review.comment.delete")}
          data-testid={`review-comment-delete-${comment.id}`}
          onClick={handleDelete}
          className="text-destructive"
        >
          <Trash2 size={14} />
        </Button>
      </ItemActions>
    </Item>
  );
}

export function getInlineReviewThreadViewportStyle({
  viewportWidth,
  pinToViewport,
}: {
  viewportWidth?: number;
  pinToViewport: boolean;
}): CSSProperties {
  const widthStyle = viewportWidth && viewportWidth > 0 ? { width: viewportWidth } : null;
  if (!pinToViewport) {
    return { ...widthStyle };
  }
  return { position: "sticky", left: 0, ...widthStyle };
}

export function InlineReviewEditor({
  initialBody,
  onCancel,
  onSave,
  testID,
}: {
  initialBody: string;
  onCancel: () => void;
  onSave: (body: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState(initialBody);
  const trimmedBody = body.trim();
  const canSave = trimmedBody.length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = useCallback(() => onSave(trimmedBody), [onSave, trimmedBody]);
  const handleChange = useCallback(
    (event: { target: HTMLTextAreaElement }) => setBody(event.target.value),
    [],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!canSave) {
        return;
      }
      handleSave();
    },
    [canSave, handleSave, onCancel],
  );

  return (
    <Card size="sm" className="gap-3 bg-muted p-3" style={EDITOR_STYLE} data-testid={testID}>
      <Textarea
        ref={inputRef}
        aria-label={t("review.comment.label")}
        data-testid={testID ? `${testID}-input` : undefined}
        placeholder={t("review.comment.placeholder")}
        value={body}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 resize-none bg-background"
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          aria-label={t("review.comment.cancelAccessibility")}
          data-testid={testID ? `${testID}-cancel` : undefined}
          onClick={onCancel}
          variant="ghost"
          size="xs"
        >
          {t("review.comment.cancel")}
        </Button>
        <Button
          aria-label={t("review.comment.saveAccessibility")}
          data-testid={testID ? `${testID}-save` : undefined}
          onClick={handleSave}
          variant="default"
          size="xs"
          disabled={!canSave}
        >
          {t("review.comment.save")}
        </Button>
      </div>
    </Card>
  );
}

const EDITOR_STYLE: CSSProperties = { minHeight: INLINE_REVIEW_EDITOR_HEIGHT };
