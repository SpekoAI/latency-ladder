import { getClientIp } from "@/lib/session-api";
import { InMemoryTokenBucket } from "@/lib/ratelimit";
import { registerRunStart } from "@/lib/spend";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1_000;
const limiter = new InMemoryTokenBucket({
  capacity: 3,
  refillTokens: 3,
  refillIntervalMs: DAY_MS,
});

export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(getClientIp(request));

  if (!limit.allowed) {
    return Response.json(
      { error: "Daily personal run limit reached", spectator: true },
      { status: 429 },
    );
  }

  try {
    const result = await registerRunStart();

    if (!result.allowed) {
      return Response.json(
        {
          error: "The grid is full today. Watch the replay.",
          spectator: true,
          runsToday: result.runsToday,
          cap: result.cap,
        },
        { status: 429 },
      );
    }

    return Response.json({ ok: true, runsToday: result.runsToday });
  } catch {
    // The duel still works if the spend ledger is briefly unreachable; the
    // per-IP bucket above still constrains volume.
    return Response.json({ ok: true, degraded: true });
  }
}
