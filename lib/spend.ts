import { getSql } from "@/lib/db";

export const DEFAULT_DAILY_RUNS_CAP = 500;

/** Estimated marginal cost of one duel run (stt checks + one live turn). */
export const EST_USD_PER_RUN = 0.05;

export interface RunStartResult {
  allowed: boolean;
  runsToday: number;
  cap: number;
}

export function dailyRunsCap(): number {
  const raw = Number(process.env.DAILY_RUNS_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_RUNS_CAP;
}

/**
 * Atomically increments today's run counter and reports whether the run may
 * proceed. The counter still increments on the rejecting request; the cap
 * check uses the pre-increment value so exactly `cap` runs are admitted.
 */
export async function registerRunStart(): Promise<RunStartResult> {
  const sql = getSql();
  const cap = dailyRunsCap();

  const rows = await sql`
    insert into ladder.daily_spend (day, runs, est_usd)
    values (current_date, 1, ${EST_USD_PER_RUN})
    on conflict (day) do update
      set runs = ladder.daily_spend.runs + 1,
          est_usd = ladder.daily_spend.est_usd + ${EST_USD_PER_RUN}
    returning runs
  `;

  const runsToday = Number(rows[0]?.runs ?? 0);

  return { allowed: runsToday <= cap, runsToday, cap };
}
