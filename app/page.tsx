import Link from "next/link";

import { SpectatorReplay } from "@/components/SpectatorReplay";
import { getSql } from "@/lib/db";

export const revalidate = 60;

async function clubCount(): Promise<number | null> {
  try {
    const sql = getSql();
    const rows = await sql`select count(*)::int as members from ladder.club`;
    return Number(rows[0]?.members ?? 0);
  } catch {
    return null;
  }
}

export default async function Home() {
  const members = await clubCount();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-20 pt-14 sm:pt-20">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div>
          <p className="ms-readout text-xs uppercase tracking-[0.3em] text-signal">
            <span className="go-light">lights out</span>
          </p>
          <h1 className="mt-4 font-display text-[clamp(3rem,9vw,5.5rem)] font-extrabold leading-[0.95] tracking-tight">
            LATENCY
            <br />
            LADDER
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-chalk-dim">
            How fast is your brain-to-mouth gap? Race a live voice agent.
            Both of you get measured.
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-chalk-dim">
            Eight rapid questions. Your brain-to-mouth gap is timed on your
            own machine, next to the agent&apos;s measured response. Wrong
            answers do not count.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link
              href="/duel"
              className="bg-signal px-7 py-3 font-display text-base font-bold text-track transition-transform hover:-translate-y-0.5"
            >
              Start the duel
            </Link>
            <Link
              href="/ladder"
              className="text-sm text-chalk-dim underline decoration-rule underline-offset-4 hover:text-chalk"
            >
              See the ladder
            </Link>
          </div>

          <p className="mt-5 text-xs text-chalk-dim">
            Audio is scored and discarded. Nothing is stored unless you join
            the ladder.
          </p>

          <div className="tower-rule mt-10 inline-flex items-baseline gap-3 border px-4 py-3">
            <span className="font-display text-2xl font-extrabold text-fastest">
              {members === null ? "-" : members}
            </span>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-chalk-dim">
              members in the FASTER THAN THE AI club
            </span>
          </div>
        </div>

        <div className="lg:pt-10">
          <SpectatorReplay />
          <p className="mt-3 text-xs leading-relaxed text-chalk-dim">
            Every number carries its clock: your gap is measured locally on
            your device, the agent&apos;s on a live exchange. Details on the{" "}
            <Link className="underline underline-offset-2" href="/methodology">
              methodology page
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
