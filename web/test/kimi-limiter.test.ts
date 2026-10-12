import { APIError } from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKimiLimiter, LimiterTimeoutError, retryAfterMs } from "../lib/kimi-limiter";

const MINUTE = 60_000;

function rateLimited(message = "request reached organization max RPM: 3, please try again after 2 seconds") {
  return APIError.generate(429, { error: { message } }, undefined, new Headers());
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("retryAfterMs", () => {
  it("reads the wait from both Moonshot 429 messages", () => {
    expect(retryAfterMs(rateLimited())).toBe(2000);
    expect(retryAfterMs(rateLimited("Organization Rate limit exceeded, please try again after 1 seconds"))).toBe(1000);
  });

  it("defaults to one second for a 429 without a wait", () => {
    expect(retryAfterMs(rateLimited("Too many requests"))).toBe(1000);
  });

  it("is null for other errors", () => {
    expect(retryAfterMs(APIError.generate(500, { error: { message: "boom" } }, undefined, new Headers()))).toBeNull();
    expect(retryAfterMs(new Error("please try again after 1 seconds"))).toBeNull();
  });
});

describe("KimiLimiter", () => {
  it("runs one request at a time", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const gate = deferred();
    const order: string[] = [];
    const first = limiter.run(async () => {
      order.push("first start");
      await gate.promise;
      order.push("first end");
    }, { deadline: MINUTE });
    const second = limiter.run(async () => void order.push("second start"), { deadline: MINUTE });

    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(["first start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first start", "first end", "second start"]);
  });

  it("holds the slot until a started call is released", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const { release } = await limiter.start(async () => "stream", { deadline: MINUTE });
    let second = false;
    const next = limiter.run(async () => void (second = true), { deadline: MINUTE });
    await vi.advanceTimersByTimeAsync(10);
    expect(second).toBe(false);
    release();
    await next;
    expect(second).toBe(true);
  });

  it("starts at most 3 requests in any 60 s window", async () => {
    const limiter = createKimiLimiter({ rpm: 3, concurrency: 1 });
    const startedAt: number[] = [];
    const calls = Array.from({ length: 4 }, () =>
      limiter.run(async () => void startedAt.push(Date.now()), { deadline: 2 * MINUTE }),
    );
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(startedAt).toEqual([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(calls);
    expect(startedAt).toEqual([0, 0, 0, MINUTE]);
  });

  it("retries a 429 after the wait it names", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const startedAt: number[] = [];
    const call = limiter.run(async () => {
      startedAt.push(Date.now());
      if (startedAt.length === 1) throw rateLimited();
      return "ok";
    }, { deadline: MINUTE });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await call).toBe("ok");
    expect(startedAt).toEqual([0, 2000]);
  });

  it("gives up after 2 retries", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const fn = vi.fn(async () => {
      throw rateLimited("please try again after 1 seconds");
    });
    const call = limiter.run(fn, { deadline: MINUTE }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await call).toBeInstanceOf(APIError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(limiter.run(fn, { deadline: MINUTE })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fails a 429 retry that would land after the deadline", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const fn = vi.fn(async () => {
      throw rateLimited("please try again after 30 seconds");
    });
    await expect(limiter.run(fn, { deadline: 10_000 })).rejects.toBeInstanceOf(APIError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fails fast when the window cannot open before the deadline", async () => {
    const limiter = createKimiLimiter({ rpm: 3, concurrency: 1 });
    for (let i = 0; i < 3; i++) await limiter.run(async () => undefined, { deadline: MINUTE });
    await vi.advanceTimersByTimeAsync(1000);
    const fn = vi.fn(async () => "late");
    await expect(limiter.run(fn, { deadline: Date.now() + 20_000 })).rejects.toBeInstanceOf(LimiterTimeoutError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a queued call at its deadline", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise, { deadline: MINUTE });
    const fn = vi.fn(async () => "late");
    const second = limiter.run(fn, { deadline: 5000 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await second).toBeInstanceOf(LimiterTimeoutError);
    gate.resolve();
    await first;
    expect(fn).not.toHaveBeenCalled();
  });

  it("drops a queued call when its signal aborts", async () => {
    const limiter = createKimiLimiter({ rpm: 100, concurrency: 1 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise, { deadline: MINUTE });
    const abort = new AbortController();
    const fn = vi.fn(async () => "never");
    const second = limiter.run(fn, { deadline: MINUTE, signal: abort.signal }).catch((error: unknown) => error);
    abort.abort();
    expect(await second).toBeInstanceOf(Error);
    gate.resolve();
    await first;
    expect(fn).not.toHaveBeenCalled();
  });
});
