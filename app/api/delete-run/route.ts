import { getSql } from "@/lib/db";
import { getClientIp } from "@/lib/session-api";
import { InMemoryTokenBucket } from "@/lib/ratelimit";

export const runtime = "nodejs";

const limiter = new InMemoryTokenBucket({
  capacity: 10,
  refillTokens: 10,
  refillIntervalMs: 60 * 60 * 1_000,
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The run id is only ever shown to the person who created the run, so
 * possession of the id is the deletion credential. Documented on the
 * methodology page.
 */
export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(getClientIp(request));

  if (!limit.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id =
    typeof body === "object" && body !== null
      ? String((body as Record<string, unknown>).id ?? "")
      : "";

  if (!UUID_PATTERN.test(id)) {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }

  try {
    const sql = getSql();
    await sql`delete from ladder.club where run_id = ${id}`;
    const rows = await sql`delete from ladder.runs where id = ${id} returning id`;

    return Response.json({ deleted: rows.length > 0 });
  } catch {
    return Response.json({ error: "Unable to delete the run" }, { status: 500 });
  }
}
