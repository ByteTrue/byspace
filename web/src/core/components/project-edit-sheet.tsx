// Port of archive/expo-app:packages/app/src/components/project-edit-sheet.tsx: renaming a project and choosing its icon; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/project-edit-sheet.py; edit it directly.
import { Buffer } from "buffer";
import { useCallback, useMemo, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { ProjectIconSource } from "@bytetrue/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ProjectIconView } from "@/components/project-icon-view";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useToast } from "@/contexts/toast-context";
import { useFilePicker } from "@/hooks/use-file-picker";
import {
  openProjectEditForm,
  type ProjectEditFormError,
  type ProjectEditFormSnapshot,
  type ProjectEditSubmission,
  type ProjectIconIntent,
} from "@/projects/edit-form";
import { importProjectIconFromUrl } from "@/projects/import-project-icon";
import { toErrorMessage } from "@/utils/error-messages";
import { Input } from "~/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";

export interface ProjectEditSheetProps {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  projectId: string;
  projectViewKey: string;
  client: DaemonClient;
  /** False on hosts that predate custom project icons — the icon field is hidden. */
  supportsCustomIcon: boolean;
  snapshot: ProjectEditFormSnapshot;
}

/** Editing a project is its name and its icon, decided together and saved once. */
export function ProjectEditSheet({
  visible,
  onClose,
  projectId,
  projectViewKey,
  client,
  supportsCustomIcon,
  snapshot,
}: ProjectEditSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { pickFiles } = useFilePicker();
  const [form] = useState(() => openProjectEditForm(snapshot));
  const handleImageUrlInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => form.setImageUrl(event.target.value),
    [form],
  );
  const handleNameInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => form.setName(event.target.value),
    [form],
  );
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);

  const mutation = useMutation({
    mutationFn: (submission: ProjectEditSubmission) =>
      submitProjectEdit({ client, projectId, submission }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.show(t("settings.project.edit.savedToast"), { variant: "success" });
      onClose();
    },
    onError: (error) => form.setError(toFormError(error)),
  });
  const isSaving = mutation.isPending;

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  const handleSubmit = useCallback(() => {
    mutation.mutate(state.submission);
  }, [mutation, state.submission]);

  const chooseImage = useCallback(async () => {
    const file = (await pickFiles())?.[0];
    if (!file) return;
    form.setPickedImage({
      fileName: file.fileName,
      mimeType: file.mimeType,
      data: Buffer.from(file.bytes).toString("base64"),
    });
  }, [form, pickFiles]);

  const handleChooseImage = useCallback(() => {
    void chooseImage();
  }, [chooseImage]);

  const header = useMemo<SheetHeader>(() => ({ title: t("settings.project.edit.title") }), [t]);

  const footer = useMemo(
    () => (
      <div className="flex flex-1 flex-row justify-end gap-2">
        <Button variant="secondary" onClick={handleClose} disabled={isSaving}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          onClick={handleSubmit}
          data-testid="project-edit-save"
          disabled={isSaving || !state.canSubmit}
        >
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          {t("settings.project.edit.save")}
        </Button>
      </div>
    ),
    [handleClose, handleSubmit, isSaving, state.canSubmit, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      footer={footer}
      desktopMaxWidth={440}
      // Bound the compact scroller to the live snap height so the footer stays
      // on screen instead of being pushed past the bottom of the sheet.
      testID="project-edit-sheet"
    >
      <Field data-invalid={Boolean(state.error?.scope === "name" ? state.error.message : null)}>
        <FieldLabel>{t("settings.project.edit.name")}</FieldLabel>
        <Input
          data-testid="project-edit-name"
          aria-label={t("settings.project.edit.nameLabel")}
          defaultValue={state.name}
          onChange={handleNameInput}
          placeholder={snapshot.projectName}
          readOnly={isSaving}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <FieldError>{state.error?.scope === "name" ? state.error.message : null}</FieldError>
      </Field>

      {supportsCustomIcon ? (
        <Field data-invalid={Boolean(state.error?.scope === "icon" ? state.error.message : null)}>
          <FieldLabel>{t("settings.project.edit.icon")}</FieldLabel>
          <div className="flex flex-col gap-2">
            <div className="flex flex-row flex-wrap items-center gap-2">
              <ProjectIconView
                iconDataUri={state.previewDataUri}
                initial={projectInitial(snapshot.projectName)}
                projectViewKey={projectViewKey}
                size={40}
                textStyle={PREVIEW_TEXT}
              />
              <Button
                variant="outline"
                onClick={handleChooseImage}
                data-testid="project-edit-choose-image"
                disabled={isSaving}
              >
                {t("settings.project.edit.chooseImage")}
              </Button>
              {state.canUseAutomatic ? (
                <Button
                  variant="ghost"
                  onClick={form.useAutomaticIcon}
                  data-testid="project-edit-use-automatic"
                  disabled={isSaving}
                >
                  {t("settings.project.edit.useAutomatic")}
                </Button>
              ) : null}
            </div>
            <Input
              data-testid="project-edit-image-url"
              aria-label={t("settings.project.edit.imageUrl")}
              defaultValue=""
              key={state.urlResetKey}
              onChange={handleImageUrlInput}
              placeholder={t("settings.project.edit.imageUrl")}
              readOnly={isSaving}
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
            />
          </div>
          {(state.pickedFileName ?? undefined) ? (
            <FieldDescription>{state.pickedFileName ?? undefined}</FieldDescription>
          ) : null}
          <FieldError>{state.error?.scope === "icon" ? state.error.message : null}</FieldError>
        </Field>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function projectInitial(projectName: string): string {
  return projectName.trim().charAt(0).toUpperCase() || "?";
}

class ProjectEditStepError extends Error {
  constructor(
    readonly scope: ProjectEditFormError["scope"],
    cause: unknown,
  ) {
    super(toErrorMessage(cause));
    this.name = "ProjectEditStepError";
  }
}

async function step<T>(scope: ProjectEditFormError["scope"], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new ProjectEditStepError(scope, error);
  }
}

/**
 * One submit, up to two RPCs. Icon bytes are acquired before either RPC runs
 * because that is the step most likely to fail; past that point both RPCs take
 * the same inputs on a retry, so a failure between them is safe to submit again.
 */
async function submitProjectEdit(input: {
  client: DaemonClient;
  projectId: string;
  submission: ProjectEditSubmission;
}): Promise<void> {
  const { client, projectId, submission } = input;
  const { rename, icon } = submission;

  const source = icon ? await step("icon", () => acquireIconSource(icon)) : null;
  if (rename) {
    await step("name", () => client.renameProject(projectId, rename.customName));
  }
  if (source) {
    await step("icon", () => client.setProjectIcon(projectId, source));
  }
}

function acquireIconSource(intent: ProjectIconIntent): Promise<ProjectIconSource> {
  if (intent.type === "url") return importProjectIconFromUrl(intent.url);
  return Promise.resolve(intent);
}

function toFormError(error: unknown): ProjectEditFormError {
  if (error instanceof ProjectEditStepError) {
    return { scope: error.scope, message: error.message };
  }
  return { scope: "name", message: toErrorMessage(error) };
}

const PREVIEW_TEXT = { fontSize: 14, fontWeight: 500 } as const;
