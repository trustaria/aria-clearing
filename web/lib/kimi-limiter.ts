import { APIError } from "openai";

const WINDOW_MS = 60_000;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRIES = 2;

export type LimiterOptions = { rpm: number; concurrency: number; windowMs?: number };

/**
 * `deadline` is the epoch ms by which the request must have started, 429 retries included.
 * `retries` caps the 429 retries (default 2).
 */
export type RunOptions = { deadline: number; signal?: AbortSignal; retries?: number };

/** A KIMI request that could not get a slot before its deadline. */
export class LimiterTimeoutError extends Error {
  constructor() {
    super("KIMI rate limit: no request slot before the deadline");
    this.name = "LimiterTimeoutError";
  }
}

/** Milliseconds a 429 asks to wait ("please try again after N seconds"), or null when not a 429. */
export function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof APIError) || error.status !== 429) return null;
  const seconds = /after\s+(\d+(?:\.\d+)?)\s*seconds?/i.exec(error.message)?.[1];
  if (seconds) return Math.max(Number(seconds) * 1000, DEFAULT_RETRY_MS);
  const header = Number(error.headers?.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header * 1000 : DEFAULT_RETRY_MS;
}

type Waiter = {
  grant: (release: () => void) => void;
  fail: (error: Error) => void;
};

function abortError(): Error {
  const error = new Error("KIMI request aborted");
  error.name = "AbortError";
  return error;
}

/** Caps KIMI requests to `concurrency` in flight and `rpm` starts per rolling window, in FIFO order. */
export class KimiLimiter {
  private readonly rpm: number;
  private readonly concurrency: number;
  private readonly windowMs: number;
  private active = 0;
  private starts: number[] = [];
  private blockedUntil = 0;
  private queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor({ rpm, concurrency, windowMs = WINDOW_MS }: LimiterOptions) {
    this.rpm = Math.max(1, rpm);
    this.concurrency = Math.max(1, concurrency);
    this.windowMs = windowMs;
  }

  /** Runs `fn` once a slot is free, retrying 429s; the slot is freed when `fn` settles. */
  async run<T>(fn: () => Promise<T>, options: RunOptions): Promise<T> {
    const { value, release } = await this.start(fn, options);
    release();
    return value;
  }

  /**
   * Like `run`, but keeps the slot after `fn` resolves (for a stream being read);
   * the caller must call `release` when done.
   */
  async start<T>(fn: () => Promise<T>, options: RunOptions): Promise<{ value: T; release: () => void }> {
    const retries = options.retries ?? MAX_RETRIES;
    for (let attempt = 0; ; attempt++) {
      const release = await this.acquire(options.deadline, options.signal);
      try {
        return { value: await fn(), release };
      } catch (error) {
        release();
        const wait = retryAfterMs(error);
        if (wait === null || attempt >= retries || options.signal?.aborted) throw error;
        const retryAt = Date.now() + wait;
        if (retryAt > options.deadline) throw error;
        this.blockedUntil = Math.max(this.blockedUntil, retryAt);
      }
    }
  }

  /** Earliest time the window and any 429 wait allow a new start. */
  private nextStartAt(now: number): number {
    this.starts = this.starts.filter((t) => t > now - this.windowMs);
    let at = Math.max(now, this.blockedUntil);
    if (this.starts.length >= this.rpm) at = Math.max(at, this.starts[this.starts.length - this.rpm] + this.windowMs);
    return at;
  }

  private acquire(deadline: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.nextStartAt(Date.now()) > deadline) return Promise.reject(new LimiterTimeoutError());

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        this.queue = this.queue.filter((w) => w !== waiter);
      };
      const waiter: Waiter = {
        grant: (release) => {
          cleanup();
          resolve(release);
        },
        fail: (error) => {
          cleanup();
          reject(error);
          this.pump();
        },
      };
      const onAbort = () => waiter.fail(abortError());
      const timeout = setTimeout(() => waiter.fail(new LimiterTimeoutError()), Math.max(0, deadline - Date.now()));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
      this.pump();
    });
  }

  /** Starts queued requests while a slot and the window allow, else waits for the window. */
  private pump() {
    clearTimeout(this.timer);
    this.timer = undefined;
    while (this.queue.length > 0 && this.active < this.concurrency) {
      const now = Date.now();
      const at = this.nextStartAt(now);
      if (at > now) {
        this.timer = setTimeout(() => this.pump(), at - now);
        return;
      }
      const waiter = this.queue[0];
      this.active++;
      this.starts.push(now);
      let released = false;
      waiter.grant(() => {
        if (released) return;
        released = true;
        this.active--;
        this.pump();
      });
    }
  }
}

/** A limiter for tests and tools. */
export function createKimiLimiter(options: LimiterOptions): KimiLimiter {
  return new KimiLimiter(options);
}

const GLOBAL_KEY = Symbol.for("aria.kimiLimiter");
type LimiterGlobal = typeof globalThis & { [GLOBAL_KEY]?: KimiLimiter };

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The process-wide limiter, built on first use from KIMI_RPM (default 3) and KIMI_CONCURRENCY (default 1). */
export function kimiLimiter(): KimiLimiter {
  const store = globalThis as LimiterGlobal;
  store[GLOBAL_KEY] ??= new KimiLimiter({
    rpm: envNumber("KIMI_RPM", 3),
    concurrency: envNumber("KIMI_CONCURRENCY", 1),
  });
  return store[GLOBAL_KEY];
}

/** Replaces the process-wide limiter; with no argument the next use rebuilds it from env. */
export function setKimiLimiter(limiter?: KimiLimiter) {
  (globalThis as LimiterGlobal)[GLOBAL_KEY] = limiter;
}
