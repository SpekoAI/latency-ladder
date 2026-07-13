import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";

export const MIN_LADDER_CORRECT_PCT = 90;
export const MAX_HANDLE_LENGTH = 30;

export interface RunSubmission {
  handle: string;
  humanMsCorrected: number;
  humanMsRaw: number;
  agentMs: number | null;
  correctPct: number;
  cohort: string | null;
}

export function sanitizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const cleaned = raw
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^a-zA-Z0-9 _.@-]/g, "")
    .trim()
    .slice(0, MAX_HANDLE_LENGTH);

  return cleaned.length >= 2 ? cleaned : null;
}

export function hashIp(ip: string): string {
  const salt = process.env.HASH_SALT ?? "ladder";
  return createHash("sha256").update(`${ip}:${salt}`).digest("hex");
}

function asBoundedInt(value: unknown, min: number, max: number): number | null {
  const num = Number(value);

  if (!Number.isFinite(num) || num < min || num > max) {
    return null;
  }

  return Math.round(num);
}

export function parseRunSubmission(body: unknown): RunSubmission | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const handle = sanitizeHandle(record.handle);
  const humanMsCorrected = asBoundedInt(record.humanMsCorrected, -5_000, 60_000);
  const humanMsRaw = asBoundedInt(record.humanMsRaw, -5_000, 60_000);
  const agentMs =
    record.agentMs === null || record.agentMs === undefined
      ? null
      : asBoundedInt(record.agentMs, 0, 60_000);
  const correctPct = Number(record.correctPct);
  const cohort =
    typeof record.cohort === "string" && record.cohort.trim()
      ? record.cohort.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 30)
      : null;

  if (
    handle === null ||
    humanMsCorrected === null ||
    humanMsRaw === null ||
    !Number.isFinite(correctPct) ||
    correctPct < 0 ||
    correctPct > 100
  ) {
    return null;
  }

  return { handle, humanMsCorrected, humanMsRaw, agentMs, correctPct, cohort };
}

export interface InsertedRun {
  id: string;
  club: boolean;
}

export async function insertRun(
  submission: RunSubmission,
  ipHash: string,
): Promise<InsertedRun> {
  const sql = getSql();
  const club =
    submission.agentMs !== null &&
    submission.humanMsCorrected < submission.agentMs;

  const rows = await sql`
    insert into ladder.runs
      (handle, human_ms_corrected, human_ms_raw, agent_ms, correct_pct, cohort, ip_hash)
    values
      (${submission.handle}, ${submission.humanMsCorrected}, ${submission.humanMsRaw},
       ${submission.agentMs}, ${submission.correctPct}, ${submission.cohort}, ${ipHash})
    returning id
  `;

  const id = String(rows[0].id);

  if (club) {
    await sql`
      insert into ladder.club (run_id, handle)
      values (${id}, ${submission.handle})
      on conflict (run_id) do nothing
    `;
  }

  return { id, club };
}
