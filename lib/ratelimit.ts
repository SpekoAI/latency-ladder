export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Atomic consumption boundary for rate-limit storage. A Postgres
 * implementation can replace the in-memory implementation without changing
 * route handlers. Database implementations must make consume atomic per key.
 */
export interface RateLimiter {
  consume(key: string, nowMs?: number): Promise<RateLimitResult>;
}

export interface TokenBucketOptions {
  capacity: number;
  refillTokens: number;
  refillIntervalMs: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

/**
 * Process-local token bucket for the Day 1 deployment. State resets on a
 * restart and is not shared across instances. Replace this class with an
 * atomic Postgres implementation before horizontally scaling the service.
 */
export class InMemoryTokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly msPerToken: number;
  private readonly now: () => number;

  constructor(options: TokenBucketOptions) {
    assertPositiveFinite(options.capacity, "capacity");
    assertPositiveFinite(options.refillTokens, "refillTokens");
    assertPositiveFinite(options.refillIntervalMs, "refillIntervalMs");

    this.capacity = options.capacity;
    this.msPerToken = options.refillIntervalMs / options.refillTokens;
    this.now = options.now ?? Date.now;
  }

  async consume(key: string, nowMs = this.now()): Promise<RateLimitResult> {
    const normalizedKey = key.trim();

    if (!normalizedKey) {
      throw new TypeError("Rate-limit key must not be blank");
    }

    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new RangeError("nowMs must be finite and non-negative");
    }

    const current = this.buckets.get(normalizedKey) ?? {
      tokens: this.capacity,
      updatedAtMs: nowMs,
    };
    const elapsedMs = Math.max(0, nowMs - current.updatedAtMs);
    const available = Math.min(
      this.capacity,
      current.tokens + elapsedMs / this.msPerToken,
    );

    if (available < 1) {
      this.buckets.set(normalizedKey, {
        tokens: available,
        updatedAtMs: Math.max(nowMs, current.updatedAtMs),
      });

      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.ceil((1 - available) * this.msPerToken),
      };
    }

    const tokens = available - 1;
    this.buckets.set(normalizedKey, {
      tokens,
      updatedAtMs: Math.max(nowMs, current.updatedAtMs),
    });

    return {
      allowed: true,
      remaining: Math.floor(tokens),
      retryAfterMs: 0,
    };
  }

  clear(): void {
    this.buckets.clear();
  }
}
