"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  QUESTIONS,
  getQuestion,
  matchesExpectedAnswer,
  type QuestionId,
} from "@/lib/questions";
import {
  buildTimingLedger,
  type TimingEvent,
  type TimingLedger,
} from "@/lib/timing";
import {
  estimateAudioChainPenaltyMs,
  playCalibrationBeep,
  type CalibrationSample,
} from "@/lib/calibration";
import { encodeWavPcm16 } from "@/lib/wav-encode";
import { bandFor } from "@/lib/bands";
import { SpectatorReplay } from "@/components/SpectatorReplay";
import { QrLink } from "@/components/QrLink";

type Phase =
  | "intro"
  | "preparing"
  | "calibrating"
  | "countdown"
  | "round"
  | "bonus"
  | "result"
  | "denied"
  | "unsupported"
  | "spectator";

interface RoundView {
  id: QuestionId;
  prompt: string;
  state: "pending" | "playing" | "listening" | "ok" | "dq" | "timeout" | "reflex";
  gapMs: number | null;
  answerText: string | null;
}

interface AgentMeasurement {
  ms: number;
  mode: "live" | "components";
  label: string;
}

interface PublishState {
  status: "idle" | "saving" | "saved" | "error";
  id: string | null;
  club: boolean;
  error: string | null;
}

const LISTEN_TIMEOUT_MS = 6_000;
const ANSWER_WINDOW_MS = 4_000;
const MAX_BAR_MS = 1_400;
const BONUS_CONNECT_TIMEOUT_MS = 6_000;
const BONUS_EXCHANGE_TIMEOUT_MS = 20_000;

function barWidthPct(gapMs: number): number {
  return Math.min(100, Math.max(4, (Math.abs(gapMs) / MAX_BAR_MS) * 100));
}

function initialRounds(): RoundView[] {
  return QUESTIONS.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    state: "pending",
    gapMs: null,
    answerText: null,
  }));
}

function supportsDuel(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined"
  );
}

export function Duel() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [rounds, setRounds] = useState<RoundView[]>(initialRounds);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [countdown, setCountdown] = useState(3);
  const [penaltyMs, setPenaltyMs] = useState<number | null>(null);
  const [liveGapMs, setLiveGapMs] = useState<number | null>(null);
  const [agent, setAgent] = useState<AgentMeasurement | null>(null);
  const [bonusNote, setBonusNote] = useState<string>("");
  const [ledger, setLedger] = useState<TimingLedger | null>(null);
  const [percentile, setPercentile] = useState<number | null>(null);
  const [handle, setHandle] = useState("");
  const [publish, setPublish] = useState<PublishState>({
    status: "idle",
    id: null,
    club: false,
    error: null,
  });
  const [spectatorMessage, setSpectatorMessage] = useState("");
  const [needsAudioTap, setNeedsAudioTap] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<AudioWorkletNode | null>(null);
  const recorderRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const buffersRef = useRef<Map<QuestionId, AudioBuffer>>(new Map());
  const eventsRef = useRef<TimingEvent[]>([]);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sttLatenciesRef = useRef<number[]>([]);
  const lastVoiceEndRef = useRef<number | null>(null);
  const conversationRef = useRef<{ endSession: () => Promise<void> } | null>(
    null,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    conversationRef.current?.endSession().catch(() => undefined);
    conversationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const drawWaveRing = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;

    if (!canvas || !analyser) {
      return;
    }

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) {
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = (): void => {
      analyser.getByteTimeDomainData(data);
      const { width, height } = canvas;
      ctx2d.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const bars = 72;
      const inner = Math.min(cx, cy) * 0.62;

      for (let index = 0; index < bars; index += 1) {
        const sample = data[Math.floor((index / bars) * data.length)];
        const magnitude = Math.abs(sample - 128) / 128;
        const length = 4 + magnitude * (Math.min(cx, cy) * 0.3);
        const angle = (index / bars) * Math.PI * 2 - Math.PI / 2;
        ctx2d.strokeStyle =
          magnitude > 0.02 ? "oklch(0.72 0.16 145)" : "oklch(0.32 0.008 260)";
        ctx2d.lineWidth = 3;
        ctx2d.beginPath();
        ctx2d.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx2d.lineTo(
          cx + Math.cos(angle) * (inner + length),
          cy + Math.sin(angle) * (inner + length),
        );
        ctx2d.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const updateRound = useCallback(
    (index: number, patch: Partial<RoundView>) => {
      setRounds((current) =>
        current.map((round, roundIndex) =>
          roundIndex === index ? { ...round, ...patch } : round,
        ),
      );
    },
    [],
  );

  /** Waits for one VAD onset newer than afterMs on the audio clock. */
  const waitForOnset = useCallback(
    (afterMs: number, timeoutMs: number): Promise<number | null> => {
      const vad = vadRef.current;

      if (!vad) {
        return Promise.resolve(null);
      }

      vad.port.postMessage({ type: "reset" });

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          vad.port.removeEventListener("message", onMessage);
          resolve(null);
        }, timeoutMs);

        const onMessage = (event: MessageEvent): void => {
          const message = event.data as
            | { type?: string; tsMs?: number; lastVoiceTsMs?: number }
            | undefined;

          if (message?.type === "offset" && Number.isFinite(message.lastVoiceTsMs)) {
            lastVoiceEndRef.current = message.lastVoiceTsMs as number;
            return;
          }

          if (
            message?.type === "onset" &&
            Number.isFinite(message.tsMs) &&
            (message.tsMs as number) >= afterMs
          ) {
            clearTimeout(timer);
            vad.port.removeEventListener("message", onMessage);
            resolve(message.tsMs as number);
          }
        };

        vad.port.addEventListener("message", onMessage);
        vad.port.start();
      });
    },
    [],
  );

  const recordAnswer = useCallback(async (): Promise<Uint8Array | null> => {
    const recorder = recorderRef.current;
    const ctx = ctxRef.current;

    if (!recorder || !ctx) {
      return null;
    }

    pcmChunksRef.current = [];

    const onChunk = (event: MessageEvent): void => {
      const message = event.data as
        | { type?: string; samples?: Float32Array }
        | undefined;

      if (message?.type === "chunk" && message.samples) {
        pcmChunksRef.current.push(message.samples);
      }
    };

    recorder.port.addEventListener("message", onChunk);
    recorder.port.start();
    recorder.port.postMessage({ type: "start" });

    await new Promise((resolve) => setTimeout(resolve, ANSWER_WINDOW_MS));

    recorder.port.postMessage({ type: "stop" });
    recorder.port.removeEventListener("message", onChunk);

    if (pcmChunksRef.current.length === 0) {
      return null;
    }

    return encodeWavPcm16(pcmChunksRef.current, ctx.sampleRate);
  }, []);

  const checkAnswer = useCallback(
    async (questionId: QuestionId, wav: Uint8Array | null) => {
      if (!wav) {
        return { text: "", correct: false };
      }

      try {
        const response = await fetch("/api/stt-check", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Blob([wav.buffer as ArrayBuffer]),
        });

        if (!response.ok) {
          return { text: "", correct: false };
        }

        const payload = (await response.json()) as {
          text?: string;
          msElapsed?: number;
        };

        if (Number.isFinite(payload.msElapsed)) {
          sttLatenciesRef.current.push(payload.msElapsed as number);
        }

        const text = payload.text ?? "";
        return {
          text,
          correct: matchesExpectedAnswer(getQuestion(questionId), text),
        };
      } catch {
        return { text: "", correct: false };
      }
    },
    [],
  );

  const runBonusRound = useCallback(async (): Promise<AgentMeasurement | null> => {
    const ctx = ctxRef.current;

    if (!ctx) {
      return null;
    }

    setBonusNote("Connecting a live agent...");

    try {
      const minted = await fetch("/api/session", { method: "POST" });

      if (!minted.ok) {
        throw new Error("mint failed");
      }

      const session = (await minted.json()) as {
        transportToken: string;
        transportUrl: string;
      };

      const { VoiceConversation } = await import("@spekoai/client");
      const perfToAudioOffset = performance.now() - ctx.currentTime * 1_000;
      let firstAgentSpeakAfterUserEnd: number | null = null;
      let userSpokeOnce = false;

      const measured = await new Promise<number | null>((resolve) => {
        let settled = false;
        const settle = (value: number | null): void => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };

        const connectTimer = setTimeout(
          () => settle(null),
          BONUS_CONNECT_TIMEOUT_MS + BONUS_EXCHANGE_TIMEOUT_MS,
        );

        VoiceConversation.create({
          transportToken: session.transportToken,
          transportUrl: session.transportUrl,
          onConnect: () => {
            setBonusNote(
              "Live round: answer the agent's question out loud, once.",
            );
          },
          onAudioPlaybackBlocked: () => {
            setNeedsAudioTap(true);
          },
          onModeChange: (mode) => {
            const nowAudioMs = performance.now() - perfToAudioOffset;

            if (mode === "listening") {
              // Agent finished a turn; the user's next speech end is the
              // measurement anchor.
              userSpokeOnce = true;
              return;
            }

            if (
              mode === "speaking" &&
              userSpokeOnce &&
              lastVoiceEndRef.current !== null
            ) {
              firstAgentSpeakAfterUserEnd =
                nowAudioMs - lastVoiceEndRef.current;
              clearTimeout(connectTimer);
              settle(firstAgentSpeakAfterUserEnd);
            }
          },
          onError: () => settle(null),
          onDisconnect: () => settle(firstAgentSpeakAfterUserEnd),
        })
          .then((conversation) => {
            conversationRef.current = conversation;
          })
          .catch(() => settle(null));
      });

      await conversationRef.current?.endSession().catch(() => undefined);
      conversationRef.current = null;

      if (measured !== null && measured > 0 && measured < 10_000) {
        return {
          ms: Math.round(measured),
          mode: "live",
          label: "live exchange this run, event-clock resolution",
        };
      }
    } catch {
      // fall through to the component fallback
    }

    setBonusNote("Live round unavailable. Measuring pipeline components...");

    try {
      const probe = await fetch("/api/synth-probe", { method: "POST" });

      if (!probe.ok) {
        return null;
      }

      const payload = (await probe.json()) as {
        ttsFirstByteMs?: number | null;
      };
      const stt = [...sttLatenciesRef.current].sort((a, b) => a - b);
      const sttMedian = stt.length
        ? stt[Math.floor(stt.length / 2)]
        : null;

      if (sttMedian !== null && Number.isFinite(payload.ttsFirstByteMs)) {
        return {
          ms: Math.round(sttMedian + (payload.ttsFirstByteMs as number)),
          mode: "components",
          label:
            "pipeline components measured this run: STT round trip + TTS first byte (no live turn)",
        };
      }
    } catch {
      // no agent number this run
    }

    return null;
  }, []);

  const start = useCallback(async () => {
    if (!supportsDuel()) {
      setPhase("unsupported");
      return;
    }

    setPhase("preparing");

    const gate = await fetch("/api/run-start", { method: "POST" }).catch(
      () => null,
    );

    if (gate && gate.status === 429) {
      const payload = (await gate.json().catch(() => null)) as {
        error?: string;
      } | null;
      setSpectatorMessage(
        payload?.error ?? "The grid is full today. Watch the replay.",
      );
      setPhase("spectator");
      return;
    }

    let calStream: MediaStream | null = null;

    try {
      // Calibration wants the acoustic echo, so echo cancellation is off for
      // this short-lived stream only.
      calStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      setPhase("denied");
      return;
    }

    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/vad-worklet.js");
      await ctx.audioWorklet.addModule("/pcm-recorder-worklet.js");

      // Preload every question so playback-end timestamps are exact.
      for (const question of QUESTIONS) {
        const response = await fetch(`/questions/${question.id}.wav`);
        const bytes = await response.arrayBuffer();
        buffersRef.current.set(question.id, await ctx.decodeAudioData(bytes));
      }

      setPhase("calibrating");

      const calSource = ctx.createMediaStreamSource(calStream);
      const calVad = new AudioWorkletNode(ctx, "vad-worklet");
      calSource.connect(calVad);

      const samples: CalibrationSample[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          samples.push(await playCalibrationBeep(ctx, calVad));
        } catch {
          break;
        }
      }

      calSource.disconnect();
      calVad.disconnect();
      calStream.getTracks().forEach((track) => track.stop());
      calStream = null;

      setPenaltyMs(
        samples.length > 0
          ? Math.round(estimateAudioChainPenaltyMs(samples))
          : null,
      );

      // The duel stream keeps echo cancellation on so the speaker playback of
      // each question is removed from the microphone path.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const vad = new AudioWorkletNode(ctx, "vad-worklet");
      const recorder = new AudioWorkletNode(ctx, "pcm-recorder-worklet");
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(vad);
      source.connect(recorder);
      source.connect(analyser);
      vadRef.current = vad;
      recorderRef.current = recorder;
      analyserRef.current = analyser;

      setPhase("countdown");
      for (const value of [3, 2, 1]) {
        if (cancelledRef.current) {
          return;
        }
        setCountdown(value);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      drawWaveRing();
      setPhase("round");
      eventsRef.current = [];
      sttLatenciesRef.current = [];

      let bestGap = Number.POSITIVE_INFINITY;

      for (const [index, question] of QUESTIONS.entries()) {
        if (cancelledRef.current) {
          return;
        }

        setActiveIndex(index);
        setLiveGapMs(null);
        updateRound(index, { state: "playing" });

        const buffer = buffersRef.current.get(question.id);
        if (!buffer) {
          updateRound(index, { state: "timeout" });
          continue;
        }

        const startAt = ctx.currentTime + 0.15;
        const endAudioMs = (startAt + buffer.duration) * 1_000;
        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.connect(ctx.destination);

        // Arm VAD while the question plays so an anticipatory answer counts
        // as a negative gap (interruption reflex).
        const onsetPromise = waitForOnset(
          startAt * 1_000,
          buffer.duration * 1_000 + 150 + LISTEN_TIMEOUT_MS,
        );

        sourceNode.start(startAt);

        eventsRef.current.push({
          type: "question_audio_end",
          roundId: question.id,
          tsMs: endAudioMs,
        });

        // Arm the recorder as playback ends.
        const untilEndMs = Math.max(0, endAudioMs - ctx.currentTime * 1_000);
        setTimeout(() => {
          updateRound(index, { state: "listening" });
        }, untilEndMs);

        const answerPromise = new Promise<Uint8Array | null>((resolve) => {
          setTimeout(() => {
            recordAnswer().then(resolve);
          }, untilEndMs);
        });

        const onsetMs = await onsetPromise;

        if (onsetMs === null) {
          await answerPromise;
          updateRound(index, { state: "timeout", gapMs: null });
          continue;
        }

        const gap = Math.round(onsetMs - endAudioMs);
        setLiveGapMs(gap);
        if (Math.abs(gap) < bestGap) {
          bestGap = Math.abs(gap);
        }

        eventsRef.current.push({
          type: "user_onset",
          roundId: question.id,
          tsMs: onsetMs,
        });

        const wav = await answerPromise;
        const graded = await checkAnswer(question.id, wav);

        eventsRef.current.push({
          type: "user_answer_text",
          roundId: question.id,
          tsMs: ctx.currentTime * 1_000,
          text: graded.text,
          correct: graded.correct,
        });

        updateRound(index, {
          state: graded.correct ? (gap < 0 ? "reflex" : "ok") : "dq",
          gapMs: gap,
          answerText: graded.text || null,
        });

        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      setActiveIndex(-1);
      setPhase("bonus");
      const agentMeasurement = await runBonusRound();
      setAgent(agentMeasurement);

      const finalLedger = buildTimingLedger(
        eventsRef.current,
        penaltyMs ?? 0,
      );
      setLedger(finalLedger);

      const corrected =
        finalLedger.aggregate.correctedMedianRangeMs?.minMs ?? null;

      if (corrected !== null) {
        fetch(`/api/run?percentileFor=${Math.round(corrected)}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (payload && Number.isFinite(payload.percentile)) {
              setPercentile(payload.percentile as number);
            }
          })
          .catch(() => undefined);
      }

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      setPhase("result");
    } catch {
      calStream?.getTracks().forEach((track) => track.stop());
      cleanupAudio();
      setPhase("unsupported");
    }
  }, [
    checkAnswer,
    cleanupAudio,
    drawWaveRing,
    penaltyMs,
    recordAnswer,
    runBonusRound,
    updateRound,
    waitForOnset,
  ]);

  const submitToLadder = useCallback(async () => {
    if (!ledger) {
      return;
    }

    const corrected = ledger.aggregate.correctedMedianRangeMs;
    const raw = ledger.aggregate.medianMs;

    if (!corrected || raw === null) {
      return;
    }

    setPublish({ status: "saving", id: null, club: false, error: null });

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle,
          humanMsCorrected: Math.round(corrected.minMs),
          humanMsRaw: Math.round(raw),
          agentMs: agent?.ms ?? null,
          correctPct: Math.round(ledger.aggregate.correctPct),
        }),
      });

      const payload = (await response.json()) as {
        id?: string;
        club?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.id) {
        setPublish({
          status: "error",
          id: null,
          club: false,
          error: payload.error ?? "Unable to save the run",
        });
        return;
      }

      try {
        localStorage.setItem("ladder-last-run-id", payload.id);
      } catch {
        // storage unavailable is fine
      }

      setPublish({
        status: "saved",
        id: payload.id,
        club: Boolean(payload.club),
        error: null,
      });
    } catch {
      setPublish({
        status: "error",
        id: null,
        club: false,
        error: "Unable to save the run",
      });
    }
  }, [agent, handle, ledger]);

  const deleteRun = useCallback(async () => {
    if (!publish.id) {
      return;
    }

    await fetch("/api/delete-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: publish.id }),
    }).catch(() => undefined);

    setPublish({ status: "idle", id: null, club: false, error: null });
  }, [publish.id]);

  if (phase === "intro") {
    return (
      <IntroCard onStart={start} />
    );
  }

  if (phase === "unsupported" || phase === "denied") {
    return (
      <div className="mx-auto max-w-xl px-6 py-14">
        <h1 className="font-display text-3xl font-extrabold">
          {phase === "denied"
            ? "The duel needs your microphone"
            : "This browser cannot run the duel"}
        </h1>
        <p className="mt-4 text-chalk-dim">
          {phase === "denied"
            ? "Timing your first word requires hearing it. Audio is scored and discarded; nothing is stored unless you join the ladder."
            : "In-app browsers often block microphone access. Open this page in Safari or Chrome to race."}
        </p>
        <div className="mt-8">
          <SpectatorReplay />
        </div>
        <div className="mt-8">
          <QrLink url="https://latency.speko.dev/duel" label="Scan to race on a desktop" />
        </div>
      </div>
    );
  }

  if (phase === "spectator") {
    return (
      <div className="mx-auto max-w-xl px-6 py-14">
        <h1 className="font-display text-3xl font-extrabold">{spectatorMessage}</h1>
        <p className="mt-3 text-chalk-dim">
          The daily run budget protects the live agents. Come back tomorrow or
          watch how a run plays out.
        </p>
        <div className="mt-8">
          <SpectatorReplay />
        </div>
      </div>
    );
  }

  if (phase === "result" && ledger) {
    return (
      <ResultBoard
        ledger={ledger}
        agent={agent}
        penaltyMs={penaltyMs}
        percentile={percentile}
        rounds={rounds}
        handle={handle}
        onHandleChange={setHandle}
        publish={publish}
        onPublish={submitToLadder}
        onDelete={deleteRun}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(200px,0.8fr)_1.4fr_minmax(180px,0.7fr)]">
        <aside className="order-2 lg:order-1">
          <p className="ms-readout mb-3 text-xs uppercase tracking-[0.25em] text-chalk-dim">
            Timing tower
          </p>
          <ol className="space-y-2">
            {rounds.map((round, index) => (
              <li
                key={round.id}
                className={`grid grid-cols-[1.5rem_1fr_4.5rem] items-center gap-2 border-l-2 pl-2 ${
                  index === activeIndex
                    ? "border-signal"
                    : "border-transparent"
                }`}
              >
                <span className="ms-readout text-xs text-chalk-dim">
                  Q{index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs text-chalk-dim">
                    {round.state === "pending" ? "..." : round.prompt}
                  </p>
                  <div
                    className="gap-bar mt-1"
                    data-state={
                      round.state === "dq"
                        ? "dq"
                        : round.gapMs !== null
                          ? "ok"
                          : "pending"
                    }
                    style={{
                      width:
                        round.gapMs !== null
                          ? `${barWidthPct(round.gapMs)}%`
                          : "4%",
                    }}
                  />
                </div>
                <span
                  className={`ms-readout text-right text-sm ${
                    round.state === "dq"
                      ? "text-alert"
                      : round.state === "reflex"
                        ? "text-fastest"
                        : "text-chalk"
                  }`}
                >
                  {round.state === "dq"
                    ? "DQ"
                    : round.state === "timeout"
                      ? "-"
                      : round.gapMs !== null
                        ? `${round.gapMs}`
                        : ""}
                </span>
              </li>
            ))}
          </ol>
        </aside>

        <section className="order-1 flex flex-col items-center justify-center py-6 text-center lg:order-2">
          {phase === "preparing" && (
            <p className="text-chalk-dim">Loading the grid...</p>
          )}
          {phase === "calibrating" && (
            <div>
              <p className="font-display text-2xl font-bold">Calibrating</p>
              <p className="mt-2 max-w-sm text-sm text-chalk-dim">
                Three short beeps measure your speaker-to-microphone chain so
                your number can be corrected for your hardware.
              </p>
            </div>
          )}
          {phase === "countdown" && (
            <p className="ms-readout font-display text-[clamp(4rem,12vw,7rem)] font-extrabold text-signal">
              {countdown}
            </p>
          )}
          {(phase === "round" || phase === "bonus") && (
            <>
              <div className="relative h-56 w-56">
                <canvas
                  ref={canvasRef}
                  width={224}
                  height={224}
                  className="absolute inset-0"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="ms-readout text-[2.6rem] font-semibold">
                    {liveGapMs === null ? "--" : `${liveGapMs}`}
                    <span className="ml-1 text-base text-chalk-dim">ms</span>
                  </span>
                </div>
              </div>
              <p className="mt-4 min-h-10 max-w-sm text-sm text-chalk-dim">
                {phase === "bonus"
                  ? bonusNote
                  : activeIndex >= 0 && rounds[activeIndex]?.state === "listening"
                    ? "Answer now."
                    : "Listen..."}
              </p>
              {needsAudioTap && (
                <button
                  type="button"
                  className="mt-2 bg-signal px-4 py-2 text-sm font-bold text-track"
                  onClick={() => {
                    setNeedsAudioTap(false);
                    conversationRef.current
                      ?.endSession()
                      .catch(() => undefined);
                  }}
                >
                  Tap if you cannot hear the agent
                </button>
              )}
            </>
          )}
        </section>

        <aside className="order-3">
          <p className="ms-readout mb-3 text-xs uppercase tracking-[0.25em] text-chalk-dim">
            Telemetry
          </p>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-chalk-dim">Correct</dt>
              <dd className="ms-readout text-lg">
                {rounds.filter((round) => round.state === "ok" || round.state === "reflex").length}
                /{QUESTIONS.length}
              </dd>
            </div>
            <div>
              <dt className="text-chalk-dim">Interruption reflex</dt>
              <dd className="ms-readout text-lg">
                {rounds.filter((round) => round.state === "reflex").length}
              </dd>
            </div>
            <div>
              <dt className="text-chalk-dim">Your audio chain</dt>
              <dd className="ms-readout text-lg">
                {penaltyMs === null ? "uncalibrated" : `~${penaltyMs}ms`}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function IntroCard({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-14">
      <p className="ms-readout text-xs uppercase tracking-[0.3em] text-signal">
        formation lap
      </p>
      <h1 className="mt-3 font-display text-4xl font-extrabold">The rules</h1>
      <ol className="mt-6 space-y-4 text-chalk-dim">
        <li className="flex gap-4">
          <span className="ms-readout text-signal">01</span>
          Eight rapid questions. Answer out loud, fast and correctly. Wrong
          answers are disqualified.
        </li>
        <li className="flex gap-4">
          <span className="ms-readout text-signal">02</span>
          Your gap is timed on your own machine, from question end to your
          first sound. The network is never in your number.
        </li>
        <li className="flex gap-4">
          <span className="ms-readout text-signal">03</span>
          One live exchange at the end measures the agent. Beat it and you
          join the FASTER THAN THE AI club.
        </li>
      </ol>
      <button
        type="button"
        onClick={onStart}
        className="mt-10 bg-signal px-8 py-3 font-display text-lg font-bold text-track transition-transform hover:-translate-y-0.5"
      >
        Ready
      </button>
      <p className="mt-4 text-xs text-chalk-dim">
        Headphones improve the measurement. Audio is scored and discarded.
      </p>
    </div>
  );
}

interface ResultBoardProps {
  ledger: TimingLedger;
  agent: AgentMeasurement | null;
  penaltyMs: number | null;
  percentile: number | null;
  rounds: RoundView[];
  handle: string;
  onHandleChange: (value: string) => void;
  publish: PublishState;
  onPublish: () => void;
  onDelete: () => void;
}

function ResultBoard({
  ledger,
  agent,
  penaltyMs,
  percentile,
  rounds,
  handle,
  onHandleChange,
  publish,
  onPublish,
  onDelete,
}: ResultBoardProps) {
  const corrected = ledger.aggregate.correctedMedianRangeMs;
  const correctPct = Math.round(ledger.aggregate.correctPct);
  const band = corrected ? bandFor(corrected.minMs) : null;
  const clubEligible =
    corrected !== null &&
    agent !== null &&
    corrected.minMs < agent.ms &&
    correctPct >= 90;

  const humanText = corrected
    ? `${Math.round(corrected.minMs)}-${Math.round(corrected.maxMs)}ms`
    : "no timed correct answers";

  const shareText = corrected
    ? `my brain-to-mouth gap: ${humanText}${
        agent ? `. the agent: ${agent.ms}ms.` : "."
      } are you faster? latency.speko.dev`
    : "i raced a voice agent at latency.speko.dev";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="ms-readout text-xs uppercase tracking-[0.3em] text-signal">
        chequered flag
      </p>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-chalk-dim">
            Your gap (median, corrected
            {penaltyMs === null ? " unavailable" : ` for ~${penaltyMs}ms chain`})
          </p>
          <p className="ms-readout mt-2 font-display text-[clamp(2.4rem,7vw,4rem)] font-extrabold leading-none">
            {humanText}
          </p>
          <p className="mt-2 text-xs text-chalk-dim">
            local clock, network excluded - {correctPct}% correct
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-chalk-dim">
            The agent
          </p>
          <p className="ms-readout mt-2 font-display text-[clamp(2.4rem,7vw,4rem)] font-extrabold leading-none text-signal">
            {agent ? `${agent.ms}ms` : "unmeasured"}
          </p>
          <p className="mt-2 text-xs text-chalk-dim">
            {agent ? agent.label : "the live round did not complete this run"}
          </p>
        </div>
      </div>

      {band && (
        <p className="mt-8 border-l-2 border-fastest pl-4 text-lg">
          <span className="font-display font-bold">{band.label}.</span>{" "}
          <span className="text-chalk-dim">{band.line}</span>
        </p>
      )}

      {clubEligible && (
        <p className="mt-4 inline-block bg-fastest px-3 py-1 font-display text-sm font-bold text-track">
          FASTER THAN THE AI - club member
        </p>
      )}

      {percentile !== null && (
        <p className="mt-4 text-sm text-chalk-dim">
          Faster than {percentile}% of the ladder.
        </p>
      )}

      <div className="mt-8">
        <p className="ms-readout mb-2 text-xs uppercase tracking-[0.25em] text-chalk-dim">
          The run
        </p>
        <ol className="space-y-1.5">
          {rounds.map((round, index) => (
            <li
              key={round.id}
              className="grid grid-cols-[1.5rem_1fr_4.5rem] items-center gap-3"
            >
              <span className="ms-readout text-xs text-chalk-dim">
                Q{index + 1}
              </span>
              <div
                className="gap-bar"
                data-state={
                  round.state === "dq"
                    ? "dq"
                    : round.state === "reflex"
                      ? "best"
                      : round.gapMs !== null
                        ? "ok"
                        : "pending"
                }
                style={{
                  width:
                    round.gapMs !== null
                      ? `${barWidthPct(round.gapMs)}%`
                      : "4%",
                }}
              />
              <span
                className={`ms-readout text-right text-sm ${
                  round.state === "dq" ? "text-alert" : "text-chalk"
                }`}
              >
                {round.state === "dq"
                  ? "DQ"
                  : round.gapMs !== null
                    ? `${round.gapMs}ms`
                    : "-"}
              </span>
            </li>
          ))}
        </ol>
        {ledger.interruptionReflex.count > 0 && (
          <p className="mt-3 text-xs text-chalk-dim">
            Interruption reflex: you started {ledger.interruptionReflex.count}{" "}
            answer{ledger.interruptionReflex.count === 1 ? "" : "s"} before the
            question ended (best lead{" "}
            {Math.round(ledger.interruptionReflex.bestLeadMs ?? 0)}ms). Those
            rounds sit outside the headline number.
          </p>
        )}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <a
          className="bg-signal px-6 py-3 font-display font-bold text-track"
          href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on X
        </a>
        <Link
          href="/duel"
          className="text-sm text-chalk-dim underline underline-offset-4 hover:text-chalk"
        >
          Run it again
        </Link>
      </div>

      <div className="tower-rule mt-10 border p-5">
        {correctPct >= 90 && corrected ? (
          publish.status === "saved" && publish.id ? (
            <div>
              <p className="text-sm">
                On the ladder{publish.club ? " and in the club" : ""}. Your
                shareable result:{" "}
                <Link
                  className="underline underline-offset-2"
                  href={`/result/${publish.id}`}
                >
                  latency.speko.dev/result/{publish.id.slice(0, 8)}...
                </Link>
              </p>
              <button
                type="button"
                onClick={onDelete}
                className="mt-3 text-xs text-chalk-dim underline underline-offset-2 hover:text-alert"
              >
                Delete this run from the ladder
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-chalk-dim">
                Join the public ladder (optional). A handle is all that is
                stored, plus these numbers.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  value={handle}
                  onChange={(event) => onHandleChange(event.target.value)}
                  placeholder="your handle"
                  maxLength={30}
                  className="tower-rule border bg-track-deep px-3 py-2 text-sm outline-none focus:border-signal"
                />
                <button
                  type="button"
                  disabled={publish.status === "saving" || handle.trim().length < 2}
                  onClick={onPublish}
                  className="bg-chalk px-5 py-2 font-display text-sm font-bold text-track disabled:opacity-40"
                >
                  {publish.status === "saving" ? "Saving..." : "Join the ladder"}
                </button>
              </div>
              {publish.error && (
                <p className="mt-2 text-xs text-alert">{publish.error}</p>
              )}
            </div>
          )
        ) : (
          <p className="text-sm text-chalk-dim">
            The public ladder accepts runs with at least 90 percent correct
            answers. {correctPct}% this time - run it again.
          </p>
        )}
      </div>
    </div>
  );
}
