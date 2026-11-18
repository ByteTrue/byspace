/** Calling releases demand; ready acknowledges the initial daemon membership. */
export type TimelineSubscription = (() => void) & { readonly ready: Promise<void> };

class TimelineInterest {
  resolve!: () => void;
  reject!: (error: unknown) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });

  constructor() {
    // Readiness is optional for fire-and-forget listeners.
    void this.ready.catch(() => {});
  }
}

/** Owns connection demand, independently of individual facades and React lifetimes. */
export class ConnectionSubscriptions {
  private viewed = new Set<string>();
  private timelines = new Map<string, Set<TimelineInterest>>();

  constructor(
    private readonly send: {
      timelines(agentIds: string[]): Promise<void> | null;
      failed(error: unknown): void;
    },
  ) {}

  private agentIds(): string[] {
    return [...new Set([...this.viewed, ...this.timelines.keys()])].sort();
  }

  setViewed(agentIds: string[]): Promise<void> {
    this.viewed = new Set(agentIds);
    return this.syncTimelines();
  }

  observeTimeline(agentId: string): TimelineSubscription {
    const interests = this.timelines.get(agentId) ?? new Set<TimelineInterest>();
    const interest = new TimelineInterest();
    interests.add(interest);
    this.timelines.set(agentId, interests);
    // Each caller gets acknowledgement for its own registration, even when an
    // existing listener first subscribed on an earlier connection.
    void this.syncTimelines().catch(this.send.failed);
    let active = true;
    return Object.assign(
      () => {
        if (!active) return;
        active = false;
        interest.reject(new Error("Timeline subscription released before it was ready"));
        interests.delete(interest);
        if (interests.size === 0) {
          this.timelines.delete(agentId);
          void this.syncTimelines().catch(this.send.failed);
        }
      },
      { ready: interest.ready },
    );
  }

  private async syncTimelines(): Promise<void> {
    const interests: TimelineInterest[] = [];
    for (const listeners of this.timelines.values()) {
      for (const interest of listeners) interests.push(interest);
    }
    try {
      const sent = this.send.timelines(this.agentIds());
      if (!sent) return;
      await sent;
      for (const interest of interests) interest.resolve();
    } catch (error) {
      for (const interest of interests) interest.reject(error);
      throw error;
    }
  }

  restore(): void {
    if (this.agentIds().length) void this.syncTimelines().catch(this.send.failed);
  }

  close(): void {
    for (const interests of this.timelines.values()) {
      for (const interest of interests) interest.reject(new Error("Daemon client closed"));
    }
  }
}
