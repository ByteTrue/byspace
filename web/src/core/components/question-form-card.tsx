// Port of archive/expo-app:packages/app/src/components/question-form-card.tsx: an agent's questions as a card —
// one tab per question once there are several, option rows (radio or checkbox), a free-text
// answer, dismiss and next/submit. The answer logic is the Expo file's.
import { useCallback, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentPermissionResponse } from "@bytetrue/protocol/agent-types";
import {
  areQuestionsAnswered,
  buildQuestionFormAnswers,
  isQuestionAnswered,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
  type QuestionFormQuestion,
  type QuestionOption,
} from "@/components/question-form-card-core";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { PendingPermission } from "@/types/shared";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void;
  isResponding: boolean;
}

function getQuestionInputPlaceholder({
  question,
  answerPlaceholder,
  otherPlaceholder,
}: {
  question: QuestionFormQuestion;
  answerPlaceholder: string;
  otherPlaceholder: string;
}): string {
  return (
    question.placeholder ?? (question.options.length === 0 ? answerPlaceholder : otherPlaceholder)
  );
}

function QuestionOptionRow({
  qIndex,
  optIndex,
  option,
  isSelected,
  multiSelect,
  isResponding,
  onToggle,
}: {
  qIndex: number;
  optIndex: number;
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  isResponding: boolean;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
}) {
  const handleClick = useCallback(
    () => onToggle(qIndex, optIndex, multiSelect),
    [onToggle, qIndex, optIndex, multiSelect],
  );
  return (
    <button
      type="button"
      role={multiSelect ? "checkbox" : "radio"}
      aria-checked={isSelected}
      aria-label={option.label}
      onClick={handleClick}
      disabled={isResponding}
      className={cn(
        "flex items-center rounded-md px-3 py-2 text-left hover:bg-muted active:opacity-90",
        isSelected && "bg-muted",
      )}
    >
      <span className="flex flex-1 items-start gap-2">
        {/* Square for multi-select, circle for single; always drawn so selecting never reflows the row. */}
        <span
          className={cn(
            "mt-0.5 flex size-[18px] shrink-0 items-center justify-center border",
            multiSelect ? "rounded-md" : "rounded-full",
            isSelected ? "border-primary" : "border-muted-foreground",
            isSelected && multiSelect && "bg-primary",
          )}
        >
          {isSelected && multiSelect ? (
            <Check size={12} className="text-primary-foreground" />
          ) : null}
          {isSelected && !multiSelect ? <span className="size-2 rounded-full bg-primary" /> : null}
        </span>
        <span className="flex flex-1 flex-col gap-1">
          <span
            className={cn(
              "text-sm leading-[22px]",
              isSelected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {option.label}
          </span>
          {option.description ? (
            <span className="text-sm leading-5 text-muted-foreground">{option.description}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function QuestionNavTab({
  header,
  index,
  count,
  isActive,
  isAnswered,
  isResponding,
  onSelect,
}: {
  header: string;
  index: number;
  count: number;
  isActive: boolean;
  isAnswered: boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}) {
  const handleClick = useCallback(() => onSelect(index), [index, onSelect]);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-label={`Question ${index + 1} of ${count}`}
      data-testid={`question-form-question-nav-${index + 1}`}
      onClick={handleClick}
      disabled={isResponding}
      className={cn(
        "flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 hover:bg-muted active:opacity-90",
        isActive
          ? "border-muted-foreground bg-muted text-foreground"
          : "bg-card text-muted-foreground",
      )}
    >
      {isAnswered ? <Check size={12} /> : null}
      <span className="truncate text-sm">{header}</span>
    </button>
  );
}

// Titled tabs (one per question header) with a check on answered ones. Hidden for a lone question.
function QuestionNav({
  questions,
  activeIndex,
  isAnswered,
  isResponding,
  onSelect,
}: {
  questions: QuestionFormQuestion[];
  activeIndex: number;
  isAnswered: (qIndex: number) => boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}) {
  if (questions.length <= 1) return null;
  return (
    <div
      role="tablist"
      data-testid="question-form-question-nav"
      className="flex flex-wrap items-center gap-1 px-3"
    >
      {questions.map((question, qIndex) => (
        <QuestionNavTab
          key={question.header}
          header={question.header}
          index={qIndex}
          count={questions.length}
          isActive={qIndex === activeIndex}
          isAnswered={isAnswered(qIndex)}
          isResponding={isResponding}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function QuestionOtherInput({
  qIndex,
  accessibilityLabel,
  value,
  placeholder,
  isResponding,
  onChange,
  onSubmit,
}: {
  qIndex: number;
  accessibilityLabel: string;
  value: string;
  placeholder: string;
  isResponding: boolean;
  onChange: (qIndex: number, text: string) => void;
  onSubmit: () => void;
}) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(qIndex, event.target.value),
    [onChange, qIndex],
  );
  return (
    <input
      aria-label={accessibilityLabel}
      placeholder={placeholder}
      defaultValue={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      disabled={isResponding}
      className={cn(
        "rounded-lg border bg-muted p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground",
        value.length > 0 && "border-input",
      )}
    />
  );
}

export function QuestionFormCard({ permission, onRespond, isResponding }: QuestionFormCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const questions = useMemo(
    () => parseQuestionFormQuestions(permission.request.input),
    [permission.request.input],
  );

  const [selections, setSelections] = useState<Record<number, Set<number>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const toggleOption = useCallback(
    (qIndex: number, optIndex: number, multiSelect: boolean) => {
      const current = selections[qIndex] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIndex)) {
          next.delete(optIndex);
        } else {
          next.add(optIndex);
        }
      } else if (next.has(optIndex)) {
        next.clear();
      } else {
        next.clear();
        next.add(optIndex);
      }

      setSelections((prev) => ({ ...prev, [qIndex]: next }));
      setOtherTexts((prev) => {
        if (!prev[qIndex]) return prev;
        const nextTexts = { ...prev };
        delete nextTexts[qIndex];
        return nextTexts;
      });

      if (!multiSelect && next.size > 0 && qIndex === activeQuestionIndex && questions) {
        setActiveQuestionIndex(Math.min(qIndex + 1, questions.length - 1));
      }
    },
    [activeQuestionIndex, questions, selections],
  );

  const setOtherText = useCallback((qIndex: number, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [qIndex]: text }));
    if (text.length > 0) {
      setSelections((prev) => {
        if (!prev[qIndex] || prev[qIndex].size === 0) return prev;
        return { ...prev, [qIndex]: new Set<number>() };
      });
    }
  }, []);

  const allAnswered = areQuestionsAnswered(questions, selections, otherTexts);
  const resolvedActiveQuestionIndex = questions
    ? Math.min(activeQuestionIndex, questions.length - 1)
    : 0;
  const activeQuestion = questions?.[resolvedActiveQuestionIndex];
  const activeQuestionAnswered = activeQuestion
    ? isQuestionAnswered(activeQuestion, resolvedActiveQuestionIndex, selections, otherTexts)
    : false;
  const isLastQuestion = questions ? resolvedActiveQuestionIndex === questions.length - 1 : true;

  const handleSubmit = useCallback(() => {
    if (!questions || !allAnswered || isResponding) return;
    setRespondingAction("submit");
    onRespond({
      behavior: "allow",
      updatedInput: {
        ...permission.request.input,
        answers: buildQuestionFormAnswers(questions, selections, otherTexts),
      },
    });
  }, [
    questions,
    allAnswered,
    isResponding,
    selections,
    otherTexts,
    onRespond,
    permission.request.input,
  ]);

  const handleDeny = useCallback(() => {
    if (!questions) return;
    setRespondingAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions)) {
      onRespond({
        behavior: "allow",
        updatedInput: {
          ...permission.request.input,
          answers: buildQuestionFormAnswers(questions, selections, otherTexts),
        },
      });
      return;
    }
    onRespond({
      behavior: "deny",
      message: "Dismissed by user",
    });
  }, [questions, onRespond, otherTexts, permission.request.input, selections]);

  const handleSelectQuestion = useCallback((index: number) => {
    setActiveQuestionIndex(index);
  }, []);

  const navIsAnswered = useCallback(
    (qIndex: number) =>
      questions ? isQuestionAnswered(questions[qIndex], qIndex, selections, otherTexts) : false,
    [questions, selections, otherTexts],
  );

  const handlePrimaryAction = useCallback(() => {
    if (!isLastQuestion) {
      if (!activeQuestionAnswered || isResponding) return;
      setActiveQuestionIndex((index) => Math.min(index + 1, (questions?.length ?? 1) - 1));
      return;
    }
    handleSubmit();
  }, [activeQuestionAnswered, handleSubmit, isLastQuestion, isResponding, questions?.length]);

  const primaryDisabled = isResponding || (isLastQuestion ? !allAnswered : !activeQuestionAnswered);
  const primaryActionLabel = isLastQuestion
    ? t("message.question.submit")
    : t("message.question.next");
  // Single-select radios need a group; checkboxes are valid standalone.
  const optionsGroupAccessibility = useMemo(
    () =>
      activeQuestion && !activeQuestion.multiSelect
        ? ({ role: "radiogroup", "aria-label": activeQuestion.question } as const)
        : {},
    [activeQuestion],
  );

  if (!questions) return null;

  const dismissLabel = resolveDismissLabel(questions, t("common.actions.dismiss"));
  const selected = selections[resolvedActiveQuestionIndex] ?? new Set<number>();
  const otherText = otherTexts[resolvedActiveQuestionIndex] ?? "";
  const showTextInput = activeQuestion ? questionShowsTextInput(activeQuestion) : false;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid="question-form-card"
    >
      <QuestionNav
        questions={questions}
        activeIndex={resolvedActiveQuestionIndex}
        isAnswered={navIsAnswered}
        isResponding={isResponding}
        onSelect={handleSelectQuestion}
      />
      <div className="flex flex-1 items-center gap-2 px-3 pb-1">
        <span
          data-testid="question-form-current-question"
          className="flex-1 text-sm leading-[22px] text-foreground"
        >
          {activeQuestion?.question}
        </span>
      </div>

      {activeQuestion ? (
        <div key={activeQuestion.question} className="flex flex-col gap-2">
          {activeQuestion.options.length > 0 ? (
            <div className="flex flex-col gap-1" {...optionsGroupAccessibility}>
              {activeQuestion.options.map((opt, optIndex) => (
                <QuestionOptionRow
                  key={opt.label}
                  qIndex={resolvedActiveQuestionIndex}
                  optIndex={optIndex}
                  option={opt}
                  isSelected={selected.has(optIndex)}
                  multiSelect={activeQuestion.multiSelect}
                  isResponding={isResponding}
                  onToggle={toggleOption}
                />
              ))}
            </div>
          ) : null}
          {showTextInput ? (
            <QuestionOtherInput
              qIndex={resolvedActiveQuestionIndex}
              accessibilityLabel={activeQuestion.question}
              value={otherText}
              placeholder={getQuestionInputPlaceholder({
                question: activeQuestion,
                answerPlaceholder: t("message.question.answerPlaceholder"),
                otherPlaceholder: t("message.question.otherPlaceholder"),
              })}
              isResponding={isResponding}
              onChange={setOtherText}
              onSubmit={handlePrimaryAction}
            />
          ) : null}
        </div>
      ) : null}

      <QuestionFormActions
        stacked={isMobile}
        dismissLabel={dismissLabel}
        primaryLabel={primaryActionLabel}
        primaryDisabled={primaryDisabled}
        isResponding={isResponding}
        respondingAction={respondingAction}
        onDismiss={handleDeny}
        onPrimary={handlePrimaryAction}
      />
    </div>
  );
}

function QuestionFormActions({
  stacked,
  dismissLabel,
  primaryLabel,
  primaryDisabled,
  isResponding,
  respondingAction,
  onDismiss,
  onPrimary,
}: {
  stacked: boolean;
  dismissLabel: string;
  primaryLabel: string;
  primaryDisabled: boolean;
  isResponding: boolean;
  respondingAction: "dismiss" | "submit" | null;
  onDismiss: () => void;
  onPrimary: () => void;
}) {
  return (
    <div className={cn("flex gap-2", stacked ? "flex-col" : "flex-row items-center justify-start")}>
      <button
        type="button"
        onClick={onDismiss}
        disabled={isResponding}
        aria-label={dismissLabel}
        data-testid="question-form-dismiss"
        className="flex items-center justify-center rounded-md border border-input bg-card px-3 py-2 hover:bg-muted active:opacity-90"
      >
        {respondingAction === "dismiss" ? (
          <Spinner className="text-muted-foreground" />
        ) : (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <X size={14} />
            {dismissLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        aria-label={primaryLabel}
        data-testid="question-form-primary-action"
        className={cn(
          "flex items-center justify-center rounded-md border border-primary bg-primary px-3 py-2 text-primary-foreground",
          primaryDisabled ? "opacity-50" : "active:opacity-90",
        )}
      >
        {respondingAction === "submit" ? (
          <Spinner />
        ) : (
          <span className="flex items-center gap-2 text-sm">
            <Check size={14} />
            {primaryLabel}
          </span>
        )}
      </button>
    </div>
  );
}
