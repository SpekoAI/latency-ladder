import type { Metadata } from "next";
import Link from "next/link";

import { getSql } from "@/lib/db";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "The ladder - Latency Ladder",
  description:
    "The public ladder of measured human conversational latency, corrected for each runner's audio chain.",
};

interface LadderRow {
  id: string;
  handle: string;
  human_ms_corrected: number;
  agent_ms: number | null;
  correct_pct: number;
  created_at: Date;
  club: boolean;
}

interface RankedRow extends LadderRow {
  verified: boolean;
}

async function loadLadder(): Promise<{
  rows: RankedRow[];
  fastestToday: RankedRow | null;
}> {
  const sql = getSql();

  const rows = (await sql`
    select r.id, r.handle, r.human_ms_corrected, r.agent_ms, r.correct_pct,
           r.created_at, (c.run_id is not null) as club
    from ladder.runs r
    left join ladder.club c on c.run_id = r.id
    where r.handle is not null
    order by r.human_ms_corrected asc
    limit 100
  `) as unknown as LadderRow[];

  // Verified = the same handle has two runs within 15 percent of each other.
  const byHandle = new Map<string, number[]>();
  for (const row of rows) {
    const list = byHandle.get(row.handle) ?? [];
    list.push(Number(row.human_ms_corrected));
    byHandle.set(row.handle, list);
  }

  const verifiedHandles = new Set<string>();
  for (const [handle, values] of byHandle) {
    const sorted = [...values].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] <= sorted[index - 1] * 1.15) {
        verifiedHandles.add(handle);
        break;
      }
    }
  }

  const ranked = rows.map((row) => ({
    ...row,
    verified: verifiedHandles.has(row.handle),
  }));

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const fastestToday =
    ranked
      .filter((row) => new Date(row.created_at) >= startOfToday)
      .sort((a, b) => a.human_ms_corrected - b.human_ms_corrected)[0] ?? null;

  return { rows: ranked, fastestToday };
}

export default async function LadderPage() {
  let data: Awaited<ReturnType<typeof loadLadder>>;

  try {
    data = await loadLadder();
  } catch {
    data = { rows: [], fastestToday: null };
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <p className="ms-readout text-xs uppercase tracking-[0.3em] text-signal">
        classification
      </p>
      <h1 className="mt-3 font-display text-4xl font-extrabold">The ladder</h1>
      <p className="mt-3 max-w-lg text-sm text-chalk-dim">
        Corrected medians, local clocks, at least 90 percent correct answers.
        Purple means the runner beat the agent they raced.
      </p>

      {data.fastestToday && (
        <p className="tower-rule mt-6 inline-block border px-4 py-2 text-sm">
          Fastest human today:{" "}
          <span className="font-display font-bold">{data.fastestToday.handle}</span>{" "}
          <span className="ms-readout">{data.fastestToday.human_ms_corrected}ms</span>
        </p>
      )}

      {data.rows.length === 0 ? (
        <div className="tower-rule mt-10 border border-dashed p-8 text-center">
          <p className="font-display text-xl font-bold">The grid is empty.</p>
          <p className="mt-2 text-sm text-chalk-dim">
            Nobody has claimed a rung yet. The first verified run tops the
            ladder by definition.
          </p>
          <Link
            href="/duel"
            className="mt-6 inline-block bg-signal px-6 py-2.5 font-display font-bold text-track"
          >
            Set the first time
          </Link>
        </div>
      ) : (
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="tower-rule border-b text-left text-xs uppercase tracking-[0.15em] text-chalk-dim">
              <th className="py-2 pr-3 font-normal">P</th>
              <th className="py-2 pr-3 font-normal">Runner</th>
              <th className="py-2 pr-3 text-right font-normal">Corrected</th>
              <th className="py-2 pr-3 text-right font-normal">Correct</th>
              <th className="py-2 font-normal">Club</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, index) => (
              <tr key={row.id} className="tower-rule border-b">
                <td className="ms-readout py-2.5 pr-3 text-chalk-dim">
                  {index + 1}
                </td>
                <td className="py-2.5 pr-3">
                  <span className={row.club ? "text-fastest" : undefined}>
                    {row.handle}
                  </span>
                  {row.verified && (
                    <span
                      className="ml-2 text-xs text-signal"
                      title="Two runs within 15 percent"
                    >
                      verified
                    </span>
                  )}
                </td>
                <td className="ms-readout py-2.5 pr-3 text-right">
                  {row.human_ms_corrected}ms
                </td>
                <td className="ms-readout py-2.5 pr-3 text-right text-chalk-dim">
                  {Math.round(row.correct_pct)}%
                </td>
                <td className="py-2.5">
                  {row.club && (
                    <span className="bg-fastest px-1.5 py-0.5 text-xs font-bold text-track">
                      FTAI
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
