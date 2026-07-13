import { getSql } from "@/lib/db";
import { getClientIp } from "@/lib/session-api";
import { InMemoryTokenBucket } from "@/lib/ratelimit";
import {
  MIN_LADDER_CORRECT_PCT,
  hashIp,
  insertRun,
  parseRunSubmission,
} from "@/lib/run-api";
import { percentileAgainst } from "@/lib/bands";

export const runtime = "nodejs";

const limiter = new InMemoryTokenBucket({
  capacity: 5,
  refillTokens: 5,
  refillIntervalMs: 60 * 60 * 1_000,
});

export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(getClientIp(request));

  if (!limit.allowed) {
    return Response.json({ error: "Too many submissions" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const submission = parseRunSubmission(body);

  if (!submission) {
    return Response.json({ error: "Invalid run submission" }, { status: 400 });
  }

  if (submission.correctPct < MIN_LADDER_CORRECT_PCT) {
    return Response.json(
      {
        error: `The public ladder only accepts runs with at least ${MIN_LADDER_CORRECT_PCT} percent correct answers`,
      },
      { status: 422 },
    );
  }

  try {
    const inserted = await insertRun(submission, hashIp(getClientIp(request)));
    return Response.json(inserted, { status: 201 });
  } catch {
    return Response.json({ error: "Unable to save the run" }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const percentileFor = Number(url.searchParams.get("percentileFor"));

  try {
    const sql = getSql();
    const rows = await sql`
      select human_ms_corrected
      from ladder.runs
      where handle is not null
      order by created_at desc
      limit 500
    `;
    const ladder = rows.map((row) => Number(row.human_ms_corrected));

    if (Number.isFinite(percentileFor)) {
      return Response.json({
        percentile: percentileAgainst(ladder, percentileFor),
        ladderSize: ladder.length,
      });
    }

    return Response.json({ ladderSize: ladder.length });
  } catch {
    return Response.json({ error: "Ladder unavailable" }, { status: 500 });
  }
}
