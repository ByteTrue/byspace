export type WorkspaceSetupOperation = (signal: AbortSignal) => Promise<void>;
export type WorkspaceSetupAfterSettled = () => Promise<void>;

interface WorkspaceSetupRun {
  controller: AbortController;
  completion: Promise<void>;
}

export class WorkspaceSetupRuntime {
  private readonly runs = new Map<string, WorkspaceSetupRun>();

  start(
    workspaceId: string,
    operation: WorkspaceSetupOperation,
    afterSettled?: WorkspaceSetupAfterSettled,
  ): Promise<void> {
    const controller = new AbortController();
    const run: WorkspaceSetupRun = {
      controller,
      completion: Promise.resolve(),
    };
    this.runs.set(workspaceId, run);
    run.completion = this.run(workspaceId, run, operation, afterSettled);
    void run.completion.catch(() => {});
    return run.completion;
  }

  async stop(workspaceId: string): Promise<void> {
    const run = this.runs.get(workspaceId);
    if (!run) {
      return;
    }
    run.controller.abort();
    await run.completion;
  }

  private async run(
    workspaceId: string,
    run: WorkspaceSetupRun,
    operation: WorkspaceSetupOperation,
    afterSettled?: WorkspaceSetupAfterSettled,
  ): Promise<void> {
    const errors: unknown[] = [];
    try {
      await operation(run.controller.signal);
    } catch (error) {
      errors.push(error);
    }

    try {
      await afterSettled?.();
    } catch (error) {
      errors.push(error);
    } finally {
      if (this.runs.get(workspaceId) === run) {
        this.runs.delete(workspaceId);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Workspace setup and post-settlement work failed");
    }
  }
}
