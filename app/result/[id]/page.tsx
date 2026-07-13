import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getSql } from "@/lib/db";
import { bandFor } from "@/lib/bands";

export const revalidate = 300;

interface ResultRow {
  id: string;
  handle: string;
  human_ms_corrected: number;
  human_ms_raw: number;
  agent_ms: number | null;
  correct_pct: number;
  club: boolean;
}

async function loadRun(id: string): Promise<ResultRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }

  try {
    const sql = getSql();
    const rows = (await sql`
      select r.id, r.handle, r.human_ms_corrected, r.human_ms_raw, r.agent_ms,
             r.correct_pct, (c.run_id is not null) as club
      from ladder.runs r
      left join ladder.club c on c.run_id = r.id
      where r.id = ${id}
      limit 1
    `) as unknown as ResultRow[];

    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const run = await loadRun(id);

  if (!run) {
    return { title: "Run not found - Latency Ladder" };
  }

  const title = `${run.handle}: ${run.human_ms_corrected}ms brain-to-mouth gap`;

  return {
    title: `${title} - Latency Ladder`,
    openGraph: {
      title,
      images: [`/result/${run.id}/og`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [`/result/${run.id}/og`],
    },
  };
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await loadRun(id);

  if (!run) {
    notFound();
  }

  const band = bandFor(run.human_ms_corrected);

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="ms-readout text-xs uppercase tracking-[0.3em] text-signal">
        official time
      </p>
      <h1 className="mt-3 font-display text-4xl font-extrabold">{run.handle}</h1>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-chalk-dim">
            Brain-to-mouth gap (corrected median, local clock)
          </p>
          <p className="ms-readout mt-2 font-display text-5xl font-extrabold">
            {run.human_ms_corrected}ms
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-chalk-dim">
            The agent that run
          </p>
          <p className="ms-readout mt-2 font-display text-5xl font-extrabold text-signal">
            {run.agent_ms === null ? "n/a" : `${run.agent_ms}ms`}
          </p>
        </div>
      </div>

      <p className="mt-6 border-l-2 border-fastest pl-4">
        <span className="font-display font-bold">{band.label}.</span>{" "}
        <span className="text-chalk-dim">{band.line}</span>
      </p>

      {run.club && (
        <p className="mt-4 inline-block bg-fastest px-3 py-1 font-display text-sm font-bold text-track">
          FASTER THAN THE AI - club member
        </p>
      )}

      <p className="mt-3 text-xs text-chalk-dim">
        {Math.round(run.correct_pct)}% correct answers. Methodology and clocks
        explained{" "}
        <Link className="underline underline-offset-2" href="/methodology">
          here
        </Link>
        .
      </p>

      <div className="mt-10">
        <Link
          href="/duel"
          className="bg-signal px-6 py-3 font-display font-bold text-track"
        >
          Beat this time
        </Link>
      </div>
    </main>
  );
}
