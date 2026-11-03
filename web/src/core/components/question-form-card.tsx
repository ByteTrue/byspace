// An agent's questions: shadcn's Questionnaire (one question at a time, radio or checkbox choices,
// a free-text answer) in a Card, with a Dismiss the card owns. The answer shape is the Expo app's
// (question-form-card-core).
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentPermissionResponse } from "@bytetrue/protocol/agent-types";
import {
  buildQuestionFormAnswers,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
  type QuestionFormQuestion,
  type QuestionOtherTexts,
  type QuestionSelections,
} from "@/components/question-form-card-core";
import type { PendingPermission } from "@/types/shared";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "~/components/ui/questionnaire";
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

function questionName(index: number): string {
  return `question-${index}`;
}

/** The form's answers in the shape the agent asked for: an option's label or the typed text. */
function readQuestionFormAnswers(
  questions: QuestionFormQuestion[],
  form: HTMLFormElement,
): Record<string, string> {
  const data = new FormData(form);
  const selections: QuestionSelections = {};
  const otherTexts: QuestionOtherTexts = {};
  questions.forEach((question, index) => {
    const labels = question.options.map((option) => option.label);
    const values = data
      .getAll(questionName(index))
      .filter((value): value is string => typeof value === "string");
    selections[index] = new Set(
      values.map((value) => labels.indexOf(value)).filter((optionIndex) => optionIndex >= 0),
    );
    const text = values.find((value) => value.length > 0 && !labels.includes(value));
    if (text) otherTexts[index] = text;
  });
  return buildQuestionFormAnswers(questions, selections, otherTexts);
}

/** An agent's questions: shadcn's Questionnaire in a Card, with a host-owned Dismiss. */
export function QuestionFormCard({ permission, onRespond, isResponding }: QuestionFormCardProps) {
  const { t } = useTranslation();
  const questions = useMemo(
    () => parseQuestionFormQuestions(permission.request.input),
    [permission.request.input],
  );
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const items = useMemo(
    () =>
      (questions ?? []).map((question, index) => ({
        name: questionName(index),
        required: !(question.allowEmpty && question.options.length === 0),
        choices: question.options.map((option) => ({ value: option.label })),
      })),
    [questions],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!questions || isResponding) return;
      setRespondingAction("submit");
      onRespond({
        behavior: "allow",
        updatedInput: {
          ...permission.request.input,
          answers: readQuestionFormAnswers(questions, event.currentTarget),
        },
      });
    },
    [isResponding, onRespond, permission.request.input, questions],
  );
  const handleDismiss = useCallback(() => {
    if (!questions) return;
    setRespondingAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions) && formRef.current) {
      onRespond({
        behavior: "allow",
        updatedInput: {
          ...permission.request.input,
          answers: readQuestionFormAnswers(questions, formRef.current),
        },
      });
      return;
    }
    onRespond({ behavior: "deny", message: "Dismissed by user" });
  }, [onRespond, permission.request.input, questions]);

  if (!questions) return null;
  const dismissLabel = resolveDismissLabel(questions, t("common.actions.dismiss"));
  return (
    <Card size="sm" data-testid="question-form-card">
      <CardContent>
        <Questionnaire ref={formRef} items={items} onSubmit={handleSubmit}>
          {questions.length > 1 ? <QuestionnaireProgress /> : null}
          {questions.map((question, index) => (
            <QuestionnaireItem
              key={questionName(index)}
              name={questionName(index)}
              required={items[index]?.required}
              multiple={question.multiSelect}
              disabled={isResponding}
            >
              <QuestionnaireTitle data-testid="question-form-current-question">
                {question.question}
              </QuestionnaireTitle>
              <QuestionnaireChoices>
                {question.options.map((option) => (
                  <QuestionnaireChoice key={option.label} value={option.label}>
                    <span className="font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="text-muted-foreground">{option.description}</span>
                    ) : null}
                  </QuestionnaireChoice>
                ))}
                {questionShowsTextInput(question) ? (
                  <QuestionnaireInput
                    aria-label={question.question}
                    placeholder={getQuestionInputPlaceholder({
                      question,
                      answerPlaceholder: t("message.question.answerPlaceholder"),
                      otherPlaceholder: t("message.question.otherPlaceholder"),
                    })}
                  />
                ) : null}
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>
          ))}
          <QuestionnaireActions>
            {/* Dismiss takes the actions row's middle slot, where a Skip button would go. */}
            <Button
              type="button"
              variant="outline"
              className="col-start-2 row-start-1 justify-self-end"
              onClick={handleDismiss}
              disabled={isResponding}
              data-testid="question-form-dismiss"
            >
              {respondingAction === "dismiss" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <X data-icon="inline-start" />
              )}
              {dismissLabel}
            </Button>
            <QuestionnairePrevious />
            <QuestionnaireNext data-testid="question-form-primary-action">
              {t("message.question.next")}
            </QuestionnaireNext>
            <QuestionnaireSubmit data-testid="question-form-primary-action" disabled={isResponding}>
              {respondingAction === "submit" ? <Spinner data-icon="inline-start" /> : null}
              {t("message.question.submit")}
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  );
}
