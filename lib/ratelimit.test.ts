import { describe, expect, test } from "bun:test";

import { InMemoryTokenBucket } from "./ratelimit";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

describe("InMemoryTokenBucket", () => {
  test("allows three immediate requests and rejects the fourth", async () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 3,
      refillTokens: 3,
      refillIntervalMs: DAY_MS,
    });

    await expect(limiter.consume("ip", 0)).resolves.toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
    await expect(limiter.consume("ip", 0)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(limiter.consume("ip", 0)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(limiter.consume("ip", 0)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 8 * HOUR_MS,
    });
  });

  test("refills continuously without exceeding capacity", async () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 3,
      refillTokens: 3,
      refillIntervalMs: DAY_MS,
    });

    await limiter.consume("ip", 0);
    await limiter.consume("ip", 0);
    await limiter.consume("ip", 0);

    await expect(limiter.consume("ip", 8 * HOUR_MS)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(limiter.consume("ip", 8 * HOUR_MS)).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 8 * HOUR_MS,
    });

    await expect(limiter.consume("ip", 10 * DAY_MS)).resolves.toMatchObject({
      allowed: true,
      remaining: 2,
    });
  });

  test("isolates buckets by key", async () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 1,
      refillTokens: 1,
      refillIntervalMs: DAY_MS,
    });

    expect((await limiter.consume("ip-a", 0)).allowed).toBe(true);
    expect((await limiter.consume("ip-a", 0)).allowed).toBe(false);
    expect((await limiter.consume("ip-b", 0)).allowed).toBe(true);
  });

  test("rejects invalid configuration, keys, and timestamps", async () => {
    expect(
      () =>
        new InMemoryTokenBucket({
          capacity: 0,
          refillTokens: 1,
          refillIntervalMs: DAY_MS,
        }),
    ).toThrow(RangeError);

    const limiter = new InMemoryTokenBucket({
      capacity: 1,
      refillTokens: 1,
      refillIntervalMs: DAY_MS,
    });

    await expect(limiter.consume(" ", 0)).rejects.toThrow(TypeError);
    await expect(limiter.consume("ip", Number.NaN)).rejects.toThrow(RangeError);
  });
});
