import { AsyncLocalStorage } from "node:async_hooks";

interface WorkspaceLifecycleScope {
  active: boolean;
}

export class WorkspaceLifecycleCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly scope = new AsyncLocalStorage<WorkspaceLifecycleScope>();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()?.active) return operation();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const scope = { active: true };
    try {
      return await this.scope.run(scope, operation);
    } finally {
      scope.active = false;
      release();
    }
  }
}

// One process hosts one daemon in production. Keeping the coordinator here makes
// every project/workspace registration and archive entry share the same barrier.
export const workspaceLifecycleCoordinator = new WorkspaceLifecycleCoordinator();
