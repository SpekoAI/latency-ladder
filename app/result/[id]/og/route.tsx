import { ImageResponse } from "next/og";

import { getSql } from "@/lib/db";
import { bandFor } from "@/lib/bands";

export const runtime = "nodejs";

const TRACK = "#26272e";
const TRACK_DEEP = "#1c1d23";
const CHALK = "#e6e7ea";
const CHALK_DIM = "#9a9ca6";
const SIGNAL = "#5bc487";
const FASTEST = "#a878d8";

interface OgRow {
  handle: string;
  human_ms_corrected: number;
  agent_ms: number | null;
  club: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  let run: OgRow | null = null;

  try {
    const sql = getSql();
    const rows = (await sql`
      select r.handle, r.human_ms_corrected, r.agent_ms,
             (c.run_id is not null) as club
      from ladder.runs r
      left join ladder.club c on c.run_id = r.id
      where r.id = ${id}
      limit 1
    `) as unknown as OgRow[];
    run = rows[0] ?? null;
  } catch {
    run = null;
  }

  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  const band = bandFor(run.human_ms_corrected);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: TRACK,
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span
            style={{
              color: SIGNAL,
              fontSize: 26,
              letterSpacing: 8,
              textTransform: "uppercase",
            }}
          >
            Latency Ladder
          </span>
          {run.club && (
            <span
              style={{
                backgroundColor: FASTEST,
                color: TRACK,
                fontSize: 24,
                fontWeight: 700,
                padding: "6px 16px",
              }}
            >
              FASTER THAN THE AI
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ color: CHALK_DIM, fontSize: 28 }}>
            {run.handle} - brain-to-mouth gap, corrected, local clock
          </span>
          <span
            style={{
              color: CHALK,
              fontSize: 132,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {run.human_ms_corrected}ms
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 20,
              marginTop: 8,
            }}
          >
            <span style={{ color: SIGNAL, fontSize: 54, fontWeight: 800 }}>
              {run.agent_ms === null ? "" : `the agent: ${run.agent_ms}ms`}
            </span>
          </div>
          <span style={{ color: CHALK_DIM, fontSize: 30, marginTop: 10 }}>
            {band.label}. {band.line}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: TRACK_DEEP,
            padding: "18px 28px",
          }}
        >
          <span style={{ color: CHALK, fontSize: 28, fontWeight: 700 }}>
            latency.speko.dev
          </span>
          <span style={{ color: CHALK_DIM, fontSize: 24 }}>
            are you faster than the AI?
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
