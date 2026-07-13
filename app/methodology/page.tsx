import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology - Latency Ladder",
  description:
    "Exactly what each number on Latency Ladder measures, which clock it comes from, and what it cannot claim.",
};

const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "Your number: local clock only",
    body: [
      "Each question is a pre-rendered audio file played from your own device. Playback end is scheduled on the browser's audio clock, so the moment the question stops is known exactly, not estimated.",
      "Your speech onset is detected by a voice-activity worklet running on the same audio clock, on your machine. The gap between those two timestamps is your number. No network request sits inside that interval.",
      "Your answer audio is then sent for transcription only to check correctness. That round trip happens after the gap is already measured and never changes it.",
    ],
  },
  {
    heading: "The correction range",
    body: [
      "Before the duel we play three short beeps and time how long the sound takes to leave your speakers and re-enter your microphone. That is your audio chain penalty: output buffering, acoustic travel, input buffering, detection block size.",
      "Your headline number is shown as a range: the raw measurement as the upper bound, and the raw measurement minus the chain penalty as the lower bound. We do not pretend the correction is more precise than it is.",
      "Headphone users often produce no measurable echo. In that case calibration is marked unavailable and the uncorrected number stands alone, labeled.",
    ],
  },
  {
    heading: "The agent's number",
    body: [
      "In the bonus round you speak once to a live voice agent. The agent's number is the time from the end of your speech (local voice-activity clock) to the platform reporting the agent speaking. Speaker-change events have coarser resolution than audio samples, so this number is labeled 'event-clock resolution'.",
      "If the live round cannot run, we fall back to summing two components measured during your run: the median speech-to-text round trip and one live text-to-speech first-byte probe. That mode is labeled 'pipeline components' and is not presented as a live conversational turn.",
      "The two numbers come from different clocks and different paths. We show both because the comparison is the point, and we label both because the comparison is only honest with the labels on.",
    ],
  },
  {
    heading: "Humans are fast. That is the game.",
    body: [
      "Cross-linguistic research (Stivers et al., PNAS 2009) puts the modal human turn-taking gap at roughly 0 to 200 milliseconds, with the English median near zero, because people anticipate the end of a question before it lands.",
      "So beating the agent is possible, expected, and celebrated: that is what the FASTER THAN THE AI club is. If you start answering before the question ends, that round is recorded as interruption reflex, kept out of the headline median.",
    ],
  },
  {
    heading: "Disqualification and the ladder",
    body: [
      "A round only counts when the transcribed answer actually answers the question. Wrong or off-question answers are disqualified: speed without correctness is noise, and a ladder of noise ranks nothing.",
      "The public ladder accepts runs with at least 90 percent correct answers. A handle earns a verified mark when two of its runs land within 15 percent of each other.",
      "Joining the ladder stores your handle and the run's numbers, nothing else. The run id shown after publishing is the deletion credential: anyone holding it can remove the run, and it is only ever shown to you.",
    ],
  },
  {
    heading: "Known limitations",
    body: [
      "Voice-activity detection has onset bias that varies by first phoneme: a hard consonant trips the detector faster than a soft vowel. Treat differences of a few tens of milliseconds between runners as within the noise.",
      "Bluetooth audio can add one hundred milliseconds or more that calibration may only partially capture. Wired headphones or laptop speakers in a quiet room measure best.",
      "Daily run caps protect the live agents. When the grid is full, the site switches to spectator mode rather than serving a degraded, slower duel and calling it a measurement.",
    ],
  },
];

export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="ms-readout text-xs uppercase tracking-[0.3em] text-signal">
        scrutineering
      </p>
      <h1 className="mt-3 font-display text-4xl font-extrabold">Methodology</h1>
      <p className="mt-4 text-chalk-dim">
        Every number on this site carries the clock it was measured on. This
        page is the full contract.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="font-display text-xl font-bold">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p
              key={paragraph.slice(0, 32)}
              className="mt-3 text-sm leading-relaxed text-chalk-dim"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <section className="tower-rule mt-12 border p-5">
        <h2 className="font-display text-lg font-bold">The stack</h2>
        <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
          Question audio is synthesized once with Speko text-to-speech. Answer
          checking uses Speko speech-to-text. The bonus round is a live Speko
          voice session. If you build voice agents, the same API is at{" "}
          <a
            className="text-chalk underline underline-offset-2"
            href="https://docs.speko.dev?utm_source=latency-ladder&utm_medium=viral&utm_campaign=viral-3x"
          >
            docs.speko.dev
          </a>
          .
        </p>
      </section>
    </main>
  );
}
