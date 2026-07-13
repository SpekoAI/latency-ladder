import type { Metadata } from "next";

import { Duel } from "@/components/Duel";

export const metadata: Metadata = {
  title: "The duel - Latency Ladder",
  description:
    "Eight rapid questions. Your brain-to-mouth gap, timed locally, next to a live agent's measured response.",
};

export default function DuelPage() {
  return (
    <main>
      <Duel />
    </main>
  );
}
