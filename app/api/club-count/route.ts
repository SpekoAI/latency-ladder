import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const sql = getSql();
    const rows = await sql`select count(*)::int as members from ladder.club`;

    return Response.json(
      { members: Number(rows[0]?.members ?? 0) },
      { headers: { "Cache-Control": "public, max-age=30" } },
    );
  } catch {
    return Response.json({ members: null }, { status: 200 });
  }
}
