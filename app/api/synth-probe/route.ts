import { getClientIp } from "@/lib/session-api";
import { InMemoryTokenBucket } from "@/lib/ratelimit";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1_000;
const limiter = new InMemoryTokenBucket({
  capacity: 3,
  refillTokens: 3,
  refillIntervalMs: DAY_MS,
});

const PROBE_TEXT = "Checking the line. One two three.";

/**
 * Fallback agent-latency probe: one short live synthesis, measured
 * server-side. Used only when the bonus live round cannot run. The audio is
 * discarded; only the timing numbers return to the client.
 */
export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(getClientIp(request));

  if (!limit.allowed) {
    return Response.json({ error: "Probe limit reached" }, { status: 429 });
  }

  const apiKey = process.env.SPEKO_API_KEY;
  const apiBase = process.env.SPEKO_API_BASE ?? "https://api.speko.dev";

  if (!apiKey) {
    return Response.json({ error: "Server configuration missing" }, { status: 500 });
  }

  const startedAt = performance.now();

  try {
    const upstream = await fetch(`${apiBase}/v1/synthesize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: PROBE_TEXT,
        intent: { language: "en", useCase: "conversational" },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      return Response.json({ error: "Probe failed" }, { status: 502 });
    }

    await upstream.arrayBuffer();

    const firstByteHeader = Number(upstream.headers.get("x-speko-first-byte-ms"));

    return Response.json({
      ttsFirstByteMs: Number.isFinite(firstByteHeader) ? firstByteHeader : null,
      ttsTotalMs: Math.round(performance.now() - startedAt),
      provider: upstream.headers.get("x-speko-provider"),
    });
  } catch {
    return Response.json({ error: "Probe failed" }, { status: 502 });
  }
}
