import { describe, expect, test } from "bun:test";
import { GitWebhookCoalescer } from "../../src/git/coalesce";

describe("GitWebhookCoalescer", () => {
  test("first call after quiet period starts immediately", async () => {
    let runs = 0;
    let now = 1_000_000;
    const c = new GitWebhookCoalescer(
      async () => {
        runs++;
      },
      5 * 60 * 1000,
      () => now,
    );

    const r = c.request();
    expect(r.action).toBe("started");
    await c.waitForIdle();
    expect(runs).toBe(1);
  });

  test("call within cooldown schedules once; further calls ignored", async () => {
    let runs = 0;
    let now = 1_000_000;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const realSetTimeout = globalThis.setTimeout;
    // @ts-expect-error test stub
    globalThis.setTimeout = (fn: () => void, ms: number) => {
      const handle = { unref() {} };
      timers.push({ at: now + Number(ms), fn: fn as () => void });
      return handle as unknown as ReturnType<typeof setTimeout>;
    };

    try {
      const c = new GitWebhookCoalescer(
        async () => {
          runs++;
        },
        5 * 60 * 1000,
        () => now,
      );

      expect(c.request().action).toBe("started");
      await c.waitForIdle();
      expect(runs).toBe(1);

      now += 60_000; // 1 min later — still in window
      expect(c.request().action).toBe("scheduled");
      expect(timers.length).toBe(1);

      now += 30_000;
      expect(c.request().action).toBe("ignored");
      expect(timers.length).toBe(1);

      // fire scheduled timer
      const t = timers.shift()!;
      now = t.at;
      t.fn();
      await c.waitForIdle();
      expect(runs).toBe(2);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("request while running reschedules follow-up", async () => {
    let runs = 0;
    let now = 1_000_000;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const timers: Array<{ at: number; fn: () => void }> = [];
    const realSetTimeout = globalThis.setTimeout;
    // @ts-expect-error test stub
    globalThis.setTimeout = (fn: () => void, ms: number) => {
      timers.push({ at: now + Number(ms), fn: fn as () => void });
      return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
    };

    try {
      const c = new GitWebhookCoalescer(
        async () => {
          runs++;
          if (runs === 1) await gate;
        },
        5 * 60 * 1000,
        () => now,
      );

      expect(c.request().action).toBe("started");
      expect(c.isRunning()).toBe(true);

      const r2 = c.request();
      expect(r2.action).toBe("rescheduled");
      expect(timers.length).toBe(1);

      release();
      await c.waitForIdle();
      expect(runs).toBe(1);

      const t = timers.shift()!;
      now = t.at;
      t.fn();
      await c.waitForIdle();
      expect(runs).toBe(2);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("after full cooldown, next call starts immediately again", async () => {
    let runs = 0;
    let now = 1_000_000;
    const c = new GitWebhookCoalescer(
      async () => {
        runs++;
      },
      5 * 60 * 1000,
      () => now,
    );

    c.request();
    await c.waitForIdle();

    now += 5 * 60 * 1000 + 1;
    expect(c.request().action).toBe("started");
    await c.waitForIdle();
    expect(runs).toBe(2);
  });
});
