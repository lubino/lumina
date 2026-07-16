/**
 * Coalesces bursty git-sync triggers (webhook hits) into bounded work.
 * See GitWebhookCoalescer.request() for the 5-minute rules.
 */

export const GIT_WEBHOOK_COOLDOWN_MS = 5 * 60 * 1000;

export type CoalesceAction =
  | "started" // sync started immediately
  | "scheduled" // first deferred run scheduled after cooldown
  | "ignored" // within cooldown / waiting; no new timer
  | "rescheduled"; // hit while a run was in progress; ensure a follow-up timer

export interface CoalesceResult {
  action: CoalesceAction;
  running: boolean;
  scheduled: boolean;
}

export type SyncRunner = () => Promise<void>;

/**
 * Debounce / coalesce gate for webhook-driven git sync.
 *
 * Rules (cooldown window = 5 minutes by default):
 * - If the endpoint has not been invoked for at least the cooldown period
 *   (or never), the sync runs immediately.
 * - If the endpoint was invoked inside the cooldown window, a single timer is
 *   armed to run the sync after the cooldown; further invocations are ignored
 *   until that timer fires (they do not stack extra timers).
 * - If a sync is already running and another request arrives, that is treated
 *   as “too soon”: a follow-up timer is set for one cooldown from now so the
 *   sync runs again after the current run finishes waiting that period.
 */
export class GitWebhookCoalescer {
  private lastEndpointCallAt = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private runChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly runner: SyncRunner,
    private readonly cooldownMs: number = GIT_WEBHOOK_COOLDOWN_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether a deferred sync is pending. */
  isScheduled(): boolean {
    return this.timer !== null;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Record a webhook (or equivalent) hit and decide whether to sync now.
   */
  request(): CoalesceResult {
    const now = this.now();
    const quiet =
      this.lastEndpointCallAt === 0 ||
      now - this.lastEndpointCallAt >= this.cooldownMs;

    this.lastEndpointCallAt = now;

    if (this.running) {
      this.ensureTimer(this.cooldownMs);
      return {
        action: "rescheduled",
        running: true,
        scheduled: this.timer !== null,
      };
    }

    if (quiet) {
      this.startRun();
      return {
        action: "started",
        running: true,
        scheduled: this.timer !== null,
      };
    }

    // Inside cooldown: arm one timer, then ignore further hits.
    if (this.timer === null) {
      this.ensureTimer(this.cooldownMs);
      return {
        action: "scheduled",
        running: false,
        scheduled: true,
      };
    }

    return {
      action: "ignored",
      running: false,
      scheduled: true,
    };
  }

  /** Cancel timers (process shutdown). Does not abort an in-flight run. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private ensureTimer(delayMs: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.startRun();
    }, delayMs);
    // Avoid keeping the event loop alive solely for git debounce in some runtimes
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref?.();
    }
  }

  private startRun(): void {
    if (this.running) {
      // Should not happen; treat as reschedule for safety.
      this.ensureTimer(this.cooldownMs);
      return;
    }
    this.running = true;
    this.runChain = this.runChain
      .then(() => this.runner())
      .catch(() => {
        // runner logs its own errors
      })
      .finally(() => {
        this.running = false;
      });
  }

  /** Test helper: wait for in-flight run to settle. */
  async waitForIdle(): Promise<void> {
    await this.runChain;
  }
}
