export type WorkspaceSetupOperation = (signal: AbortSignal) => Promise<void>;
export type WorkspaceSetupAfterSettled = () => Promise<void>;

interface WorkspaceSetupRun {
  controller: AbortController;
  completion: Promise<void>;
  error: unknown;
}

export class WorkspaceSetupRuntime {
  private readonly runs = new Map<string, WorkspaceSetupRun>();

  start(
    workspaceId: string,
    operation: WorkspaceSetupOperation,
    afterSettled?: WorkspaceSetupAfterSettled,
  ): void {
    const controller = new AbortController();
    const run: WorkspaceSetupRun = {
      controller,
      completion: Promise.resolve(),
      error: null,
    };
    this.runs.set(workspaceId, run);
    run.completion = Promise.resolve()
      .then(() => operation(controller.signal))
      .finally(() => {
        if (this.runs.get(workspaceId) === run) {
          this.runs.delete(workspaceId);
        }
      })
      .then(() => afterSettled?.())
      .catch((error) => {
        run.error = error;
      });
  }

  async stop(workspaceId: string): Promise<void> {
    const run = this.runs.get(workspaceId);
    if (!run) {
      return;
    }
    run.controller.abort();
    await run.completion;
    if (run.error !== null) {
      throw run.error;
    }
  }
}
