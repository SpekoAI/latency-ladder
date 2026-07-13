"use client";

import { useEffect, useRef, useState } from "react";

import replay from "@/data/seed-replay.json";

interface ReplayRow {
  atMs: number;
  question: string;
  gapMs: number;
  state: "ok" | "best" | "dq";
}

const ROWS = replay.rows as ReplayRow[];
const LOOP_PAUSE_MS = 2_600;
const MAX_BAR_MS = 1_400;

function barWidthPct(gapMs: number): number {
  return Math.min(100, Math.max(4, (gapMs / MAX_BAR_MS) * 100));
}

/**
 * Muted auto-playing replay of a simulated run: timing-tower rows fill in on
 * a fixed schedule so a visitor who never grants the mic still sees the whole
 * product in about ten seconds.
 */
export function SpectatorReplay() {
  const [visibleCount, setVisibleCount] = useState(0);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion.current) {
      setVisibleCount(ROWS.length);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const startLoop = (): void => {
      if (cancelled) {
        return;
      }

      setVisibleCount(0);

      for (const [index, row] of ROWS.entries()) {
        timers.push(
          setTimeout(() => {
            if (!cancelled) {
              setVisibleCount(index + 1);
            }
          }, row.atMs),
        );
      }

      timers.push(
        setTimeout(
          startLoop,
          (ROWS.at(-1)?.atMs ?? 0) + LOOP_PAUSE_MS,
        ),
      );
    };

    startLoop();

    return () => {
      cancelled = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <figure className="tower-rule border">
      <figcaption className="tower-rule flex items-center justify-between border-b px-4 py-2">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-chalk-dim">
          {replay.label}
        </span>
        <span className="ms-readout text-xs text-chalk-dim">
          agent {replay.agentMs}ms <span className="text-rule">|</span> measured live
        </span>
      </figcaption>
      <div className="bg-track-deep px-4 py-3">
        <ol className="space-y-2">
          {ROWS.map((row, index) => {
            const visible = index < visibleCount;
            return (
              <li
                key={row.question}
                className={`grid grid-cols-[1.5rem_1fr_4.5rem] items-center gap-3 ${
                  visible ? "row-in" : "opacity-25"
                }`}
              >
                <span className="ms-readout text-xs text-chalk-dim">
                  Q{index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs text-chalk-dim">{row.question}</p>
                  <div
                    className="gap-bar mt-1"
                    data-state={visible ? row.state : "pending"}
                    style={{
                      width: visible ? `${barWidthPct(row.gapMs)}%` : "4%",
                    }}
                  />
                </div>
                <span
                  className={`ms-readout text-right text-sm font-semibold ${
                    row.state === "dq"
                      ? "text-alert"
                      : row.state === "best"
                        ? "text-fastest"
                        : "text-chalk"
                  }`}
                >
                  {visible ? (row.state === "dq" ? "DQ" : `${row.gapMs}`) : "-"}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="ms-readout mt-3 text-right text-xs text-chalk-dim">
          human median {replay.summary.medianMs}ms ({replay.summary.humanLabel})
        </p>
      </div>
    </figure>
  );
}
