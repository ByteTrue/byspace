import type {
  ChiefHumanDecision,
  ChiefHumanDecisionOption,
  ChiefMissionSnapshot,
} from "@bytetrue/protocol/messages";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { toErrorMessage } from "@/lib/error-messages";
import { MessageSquareWarning } from "lucide-react";
import { useCallback, useState, type ChangeEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ChiefDecisionBannerProps {
  mission: ChiefMissionSnapshot;
  onResolveDecision: (input: {
    missionId: string;
    decisionId?: string;
    optionId: string;
    note?: string;
  }) => Promise<unknown>;
}

function resolveOptionButtonProps(style: ChiefHumanDecisionOption["style"]): {
  variant: "default" | "secondary" | "outline";
  className?: string;
} {
  if (style === "primary") {
    return { variant: "default" };
  }
  if (style === "danger") {
    return { variant: "outline", className: "text-destructive" };
  }
  return { variant: "secondary" };
}

function buildFallbackOptions(
  decision: ChiefHumanDecision,
  approveLabel: string,
): ChiefHumanDecisionOption[] {
  if (decision.options && decision.options.length > 0) {
    return decision.options;
  }
  return [{ id: "approve", label: approveLabel, style: "primary" }];
}

function DecisionOptionButton({
  option,
  resolvingOptionId,
  onSelect,
}: {
  option: ChiefHumanDecisionOption;
  resolvingOptionId: string | null;
  onSelect: (optionId: string) => void;
}): ReactElement {
  const buttonStyle = resolveOptionButtonProps(option.style);
  const isBusy = resolvingOptionId === option.id;
  const handlePress = useCallback(() => {
    onSelect(option.id);
  }, [onSelect, option.id]);

  return (
    <Button
      type="button"
      size="sm"
      variant={buttonStyle.variant}
      className={buttonStyle.className}
      disabled={resolvingOptionId !== null}
      onClick={handlePress}
      title={option.description ?? undefined}
      data-testid={`chief-decision-option-${option.id}`}
    >
      {isBusy ? <Spinner data-icon="inline-start" /> : null}
      {option.label}
    </Button>
  );
}

export function ChiefDecisionBanner({
  mission,
  onResolveDecision,
}: ChiefDecisionBannerProps): ReactElement | null {
  const { t } = useTranslation();
  const decision = mission.pendingDecision;
  const [note, setNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [resolvingOptionId, setResolvingOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleNoteChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setNote(event.target.value);
  }, []);

  const handleToggleNote = useCallback(() => {
    setShowNoteInput((current) => !current);
  }, []);

  const handleChooseOption = useCallback(
    async (optionId: string) => {
      if (!decision || resolvingOptionId !== null) {
        return;
      }
      setResolvingOptionId(optionId);
      setError(null);
      try {
        const trimmedNote = note.trim();
        await onResolveDecision({
          missionId: mission.id,
          decisionId: decision.id,
          optionId,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        });
        setNote("");
        setShowNoteInput(false);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setResolvingOptionId(null);
      }
    },
    [decision, mission.id, note, onResolveDecision, resolvingOptionId],
  );

  const triggerChooseOption = useCallback(
    (optionId: string) => {
      void handleChooseOption(optionId);
    },
    [handleChooseOption],
  );

  if (!decision) return null;

  if (decision.resolvedAt) {
    const resolvedError = decision.landingError ?? error;
    if (!resolvedError) return null;
    return (
      <Alert variant="destructive" data-testid={`chief-decision-banner-${decision.id}`}>
        <AlertTitle>
          {decision.landingError ? t("chief.decision.landingFailedTitle") : decision.title}
        </AlertTitle>
        <AlertDescription>
          {decision.landingError ? <p>{t("chief.decision.landingFailedHelp")}</p> : null}
          <p>{resolvedError}</p>
        </AlertDescription>
      </Alert>
    );
  }

  const options = buildFallbackOptions(decision, t("chief.decision.approveFallback"));
  const linkedThread = decision.threadId
    ? mission.threads.find((thread) => thread.id === decision.threadId)
    : undefined;

  return (
    <Alert data-testid={`chief-decision-banner-${decision.id}`}>
      <MessageSquareWarning className="text-status-warning" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{decision.title}</span>
        <Badge variant="secondary" className="text-status-warning">
          {t("chief.decision.badge")}
        </Badge>
        {linkedThread ? (
          <Badge variant="outline" className="max-w-[240px] truncate">
            {linkedThread.title}
          </Badge>
        ) : null}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2.5">
        <p className="text-sm text-foreground">{decision.summary}</p>

        {showNoteInput ? (
          <Input
            value={note}
            onChange={handleNoteChange}
            placeholder={t("chief.decision.notePlaceholder")}
            aria-label={t("chief.decision.notePlaceholder")}
            disabled={resolvingOptionId !== null}
            data-testid={`chief-decision-note-input-${decision.id}`}
          />
        ) : null}

        {error ? (
          <p
            role="alert"
            className="text-xs text-destructive"
            data-testid={`chief-decision-error-${decision.id}`}
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {options.map((option) => (
            <DecisionOptionButton
              key={option.id}
              option={option}
              resolvingOptionId={resolvingOptionId}
              onSelect={triggerChooseOption}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={resolvingOptionId !== null}
            onClick={handleToggleNote}
            data-testid={`chief-decision-toggle-note-${decision.id}`}
          >
            {showNoteInput ? t("chief.decision.hideNote") : t("chief.decision.addNote")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
