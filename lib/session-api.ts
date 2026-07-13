import type { RateLimiter } from "./ratelimit";

export const SESSION_TTL_MS = 120_000;
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 10;

export const QUIZMASTER_SYSTEM_PROMPT = [
  "You are a scripted quizmaster for Latency Ladder.",
  "Ask exactly one short question at a time in this order:",
  "What is seven plus eight?",
  "Name any day of the week.",
  "What color is a stop sign?",
  "What is the opposite of hot?",
  "How many legs does a spider have?",
  "What is the first month of the year?",
  "Complete the phrase: salt and what?",
  "What planet do we live on?",
  "Wait for each answer before asking the next question.",
  "Be crisp and do not add commentary.",
].join(" ");

export const SESSION_REQUEST_BODY = {
  mode: "cascade",
  intent: {
    language: "en",
    optimizeFor: "latency",
  },
  systemPrompt: QUIZMASTER_SYSTEM_PROMPT,
  voice: "a167e0f3-df7e-4d52-a9c3-f949145efdab",
  metadata: {
    product: "latency-ladder",
    source: "web",
  },
  ttlSeconds: SESSION_TTL_MS / 1_000,
} as const;

export interface SessionCapacityLease {
  id: string;
  expiresAtMs: number;
}

export interface SessionCapacity {
  tryAcquire(nowMs: number): SessionCapacityLease | null;
  release(leaseId: string): void;
  activeCount(nowMs: number): number;
}

/**
 * Tracks sessions through their full 120 second credential lifetime. This is
 * deliberately process-local for Day 1.
 * TODO: Replace with a Postgres-backed atomic lease counter before scaling to
 * more than one application instance.
 */
export class InMemorySessionCapacity implements SessionCapacity {
  private readonly leases = new Map<string, number>();

  constructor(
    private readonly maximum: number,
    private readonly leaseDurationMs: number,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    if (!Number.isInteger(maximum) || maximum <= 0) {
      throw new RangeError("maximum must be a positive integer");
    }

    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new RangeError("leaseDurationMs must be positive and finite");
    }
  }

  tryAcquire(nowMs: number): SessionCapacityLease | null {
    this.assertTimestamp(nowMs);
    this.prune(nowMs);

    if (this.leases.size >= this.maximum) {
      return null;
    }

    const id = this.createId();
    if (!id || this.leases.has(id)) {
      throw new Error("Session capacity lease id must be unique");
    }

    const expiresAtMs = nowMs + this.leaseDurationMs;
    this.leases.set(id, expiresAtMs);
    return { id, expiresAtMs };
  }

  release(leaseId: string): void {
    this.leases.delete(leaseId);
  }

  activeCount(nowMs: number): number {
    this.assertTimestamp(nowMs);
    this.prune(nowMs);
    return this.leases.size;
  }

  private prune(nowMs: number): void {
    for (const [id, expiresAtMs] of this.leases) {
      if (expiresAtMs <= nowMs) {
        this.leases.delete(id);
      }
    }
  }

  private assertTimestamp(nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new RangeError("nowMs must be finite and non-negative");
    }
  }
}

interface SpekoSessionResponse {
  sessionId: string;
  transportToken: string;
  transportUrl: string;
  livekitUrl: string;
  roomName: string;
}

export interface SessionHandlerDependencies {
  fetchImpl: typeof fetch;
  rateLimiter: RateLimiter;
  capacity: SessionCapacity;
  now: () => number;
  getConfig: () => {
    apiKey: string | undefined;
    apiBaseUrl: string | undefined;
  };
}

function jsonError(message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error: message }, { status, headers });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseSessionResponse(value: unknown): SpekoSessionResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const keys = [
    "sessionId",
    "transportToken",
    "transportUrl",
    "livekitUrl",
    "roomName",
  ] as const;

  if (!keys.every((key) => isNonEmptyString(record[key]))) {
    return null;
  }

  return {
    sessionId: record.sessionId as string,
    transportToken: record.transportToken as string,
    transportUrl: record.transportUrl as string,
    livekitUrl: record.livekitUrl as string,
    roomName: record.roomName as string,
  };
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const candidate = forwardedFor?.split(",", 1)[0]?.trim();

  return candidate || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function createSessionHandler(
  dependencies: SessionHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const { apiKey, apiBaseUrl } = dependencies.getConfig();
    if (!apiKey?.trim() || !apiBaseUrl?.trim()) {
      return jsonError("Speko server configuration is missing", 500);
    }

    const nowMs = dependencies.now();
    const lease = dependencies.capacity.tryAcquire(nowMs);
    if (!lease) {
      return jsonError("Session capacity is currently full", 503, {
        "Retry-After": "5",
      });
    }

    let rateLimit;
    try {
      rateLimit = await dependencies.rateLimiter.consume(
        getClientIp(request),
        nowMs,
      );
    } catch {
      dependencies.capacity.release(lease.id);
      return jsonError("Session rate limit is unavailable", 500);
    }

    if (!rateLimit.allowed) {
      dependencies.capacity.release(lease.id);
      return jsonError("Daily session limit reached", 429, {
        "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1_000))),
        "X-RateLimit-Remaining": "0",
      });
    }

    let upstream: Response;
    try {
      upstream = await dependencies.fetchImpl(
        `${apiBaseUrl.replace(/\/+$/, "")}/v1/sessions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(SESSION_REQUEST_BODY),
          signal: request.signal,
        },
      );
    } catch {
      dependencies.capacity.release(lease.id);
      return jsonError("Unable to create a voice session", 502);
    }

    if (!upstream.ok) {
      dependencies.capacity.release(lease.id);
      return jsonError("Unable to create a voice session", 502);
    }

    let session: SpekoSessionResponse | null = null;
    try {
      session = parseSessionResponse(await upstream.json());
    } catch {
      // The sanitized error below intentionally hides upstream response data.
    }

    if (!session) {
      dependencies.capacity.release(lease.id);
      return jsonError("Speko returned an invalid session response", 502);
    }

    return Response.json(session, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
  };
}
