import { InMemoryTokenBucket } from "@/lib/ratelimit";
import {
  DEFAULT_MAX_CONCURRENT_SESSIONS,
  InMemorySessionCapacity,
  SESSION_TTL_MS,
  createSessionHandler,
} from "@/lib/session-api";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1_000;
const sessionRateLimiter = new InMemoryTokenBucket({
  capacity: 3,
  refillTokens: 3,
  refillIntervalMs: DAY_MS,
});
const sessionCapacity = new InMemorySessionCapacity(
  DEFAULT_MAX_CONCURRENT_SESSIONS,
  SESSION_TTL_MS,
);

export const POST = createSessionHandler({
  fetchImpl: fetch,
  rateLimiter: sessionRateLimiter,
  capacity: sessionCapacity,
  now: Date.now,
  getConfig: () => ({
    apiKey: process.env.SPEKO_API_KEY,
    apiBaseUrl: process.env.SPEKO_API_BASE ?? "https://api.speko.dev",
  }),
});
