import { describe, expect, test } from "bun:test";

import { InMemoryTokenBucket, type RateLimiter } from "@/lib/ratelimit";
import {
  InMemorySessionCapacity,
  SESSION_REQUEST_BODY,
  createSessionHandler,
} from "@/lib/session-api";

const validSession = {
  sessionId: "session-id",
  transportToken: "browser-token",
  transportUrl: "wss://transport.example",
  livekitUrl: "wss://transport.example",
  roomName: "room-name",
  identity: "ignored-extra-field",
};

const allowingRateLimiter: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: 2, retryAfterMs: 0 }),
};

describe("InMemorySessionCapacity", () => {
  test("holds capacity until a lease expires or is released", () => {
    let id = 0;
    const capacity = new InMemorySessionCapacity(1, 120, () => `lease-${++id}`);
    const first = capacity.tryAcquire(0);

    expect(first).toEqual({ id: "lease-1", expiresAtMs: 120 });
    expect(capacity.tryAcquire(119)).toBeNull();
    expect(capacity.activeCount(120)).toBe(0);

    const second = capacity.tryAcquire(120);
    expect(second?.id).toBe("lease-2");
    capacity.release("lease-2");
    expect(capacity.activeCount(120)).toBe(0);
  });
});

describe("session POST handler", () => {
  test("sends the fixed payload and returns only browser-safe fields", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json(validSession, { status: 201 });
    }) as typeof fetch;
    const handler = createSessionHandler({
      fetchImpl,
      rateLimiter: allowingRateLimiter,
      capacity: new InMemorySessionCapacity(2, 120_000, () => "lease"),
      now: () => 1_000,
      getConfig: () => ({ apiKey: "server-secret", apiBaseUrl: "https://api.test/" }),
    });

    const response = await handler(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" },
      }),
    );

    expect(response.status).toBe(201);
    expect(capturedUrl).toBe("https://api.test/v1/sessions");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer server-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual(SESSION_REQUEST_BODY);
    expect(await response.json()).toEqual({
      sessionId: "session-id",
      transportToken: "browser-token",
      transportUrl: "wss://transport.example",
      livekitUrl: "wss://transport.example",
      roomName: "room-name",
    });
  });

  test("enforces the per-IP three request bucket", async () => {
    let fetchCount = 0;
    let leaseId = 0;
    const handler = createSessionHandler({
      fetchImpl: (async () => {
        fetchCount += 1;
        return Response.json(validSession, { status: 201 });
      }) as unknown as typeof fetch,
      rateLimiter: new InMemoryTokenBucket({
        capacity: 3,
        refillTokens: 3,
        refillIntervalMs: 86_400_000,
      }),
      capacity: new InMemorySessionCapacity(10, 120_000, () => `lease-${++leaseId}`),
      now: () => 0,
      getConfig: () => ({ apiKey: "secret", apiBaseUrl: "https://api.test" }),
    });
    const request = () =>
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.9" },
      });

    expect((await handler(request())).status).toBe(201);
    expect((await handler(request())).status).toBe(201);
    expect((await handler(request())).status).toBe(201);
    const rejected = await handler(request());

    expect(rejected.status).toBe(429);
    expect(fetchCount).toBe(3);
    expect(rejected.headers.get("retry-after")).toBe("28800");
  });

  test("does not expose upstream error details", async () => {
    const handler = createSessionHandler({
      fetchImpl: (async () =>
        Response.json(
          { error: "secret provider detail" },
          { status: 500 },
        )) as unknown as typeof fetch,
      rateLimiter: allowingRateLimiter,
      capacity: new InMemorySessionCapacity(1, 120_000, () => "lease"),
      now: () => 0,
      getConfig: () => ({ apiKey: "secret", apiBaseUrl: "https://api.test" }),
    });

    const response = await handler(new Request("http://localhost/api/session"));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret provider detail");
  });
});
