export interface CalibrationSample {
  scheduledBeepTsMs: number;
  detectedEchoTsMs: number;
}

export interface CalibrationSummary {
  penaltyMs: number;
  sampleCount: number;
  minMs: number;
  maxMs: number;
  jitterMs: number;
}

export interface CalibrationBeepOptions {
  frequencyHz?: number;
  durationMs?: number;
  gain?: number;
  scheduleAheadMs?: number;
  timeoutMs?: number;
}

interface VadOnsetMessage {
  type: "onset";
  tsMs: number;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

/**
 * The beep start and VAD onset both use AudioContext.currentTime. Their
 * difference therefore includes speaker output buffering, acoustic travel,
 * microphone input buffering, and AudioWorklet block detection. That total is
 * the local audio-chain penalty used by the timing ledger.
 */
export function calibrationLatencyMs(sample: CalibrationSample): number {
  assertFinite(sample.scheduledBeepTsMs, "scheduledBeepTsMs");
  assertFinite(sample.detectedEchoTsMs, "detectedEchoTsMs");

  const latencyMs = sample.detectedEchoTsMs - sample.scheduledBeepTsMs;

  if (latencyMs < 0) {
    throw new RangeError("detected echo cannot precede the scheduled beep");
  }

  return latencyMs;
}

/**
 * Median filtering makes the estimate resistant to one noisy VAD block. A
 * caller can collect several single-beep measurements and pass them here.
 */
export function estimateAudioChainPenaltyMs(
  samples: readonly CalibrationSample[],
): number {
  if (samples.length === 0) {
    throw new RangeError("at least one calibration sample is required");
  }

  const ordered = samples
    .map(calibrationLatencyMs)
    .sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);

  if (ordered.length % 2 === 1) {
    return ordered[middle];
  }

  return (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summarizeCalibration(
  samples: readonly CalibrationSample[],
): CalibrationSummary {
  const latencies = samples.map(calibrationLatencyMs);

  if (latencies.length === 0) {
    throw new RangeError("at least one calibration sample is required");
  }

  const minMs = Math.min(...latencies);
  const maxMs = Math.max(...latencies);

  return {
    penaltyMs: estimateAudioChainPenaltyMs(samples),
    sampleCount: samples.length,
    minMs,
    maxMs,
    jitterMs: maxMs - minMs,
  };
}

function isVadOnsetMessage(value: unknown): value is VadOnsetMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Partial<VadOnsetMessage>;
  return message.type === "onset" && Number.isFinite(message.tsMs);
}

/**
 * Plays one short calibration tone and waits for the microphone-connected VAD
 * worklet to hear its acoustic echo. The caller must connect a live microphone
 * MediaStreamAudioSourceNode to vadNode before calling this function. Headphone
 * users may not produce an audible echo, so the caller should treat timeout as
 * "calibration unavailable" and retain the uncorrected timing range.
 *
 * This deliberately compares AudioContext clock timestamps rather than
 * performance.now(), keeping playback scheduling and worklet detection on the
 * same monotonic clock. Resetting the worklet re-arms onset detection before the
 * tone. The returned sample can be combined with repeated runs using
 * estimateAudioChainPenaltyMs.
 */
export function playCalibrationBeep(
  audioContext: AudioContext,
  vadNode: AudioWorkletNode,
  options: CalibrationBeepOptions = {},
): Promise<CalibrationSample> {
  const frequencyHz = options.frequencyHz ?? 1_200;
  const durationMs = options.durationMs ?? 80;
  const gainValue = options.gain ?? 0.15;
  const scheduleAheadMs = options.scheduleAheadMs ?? 120;
  const timeoutMs = options.timeoutMs ?? 2_000;

  for (const [label, value] of [
    ["frequencyHz", frequencyHz],
    ["durationMs", durationMs],
    ["gain", gainValue],
    ["scheduleAheadMs", scheduleAheadMs],
    ["timeoutMs", timeoutMs],
  ] as const) {
    assertFinite(value, label);
  }

  if (frequencyHz <= 0 || durationMs <= 0 || scheduleAheadMs < 0 || timeoutMs <= 0) {
    throw new RangeError("calibration beep timing and frequency values are invalid");
  }

  if (gainValue <= 0 || gainValue > 1) {
    throw new RangeError("gain must be greater than zero and no more than one");
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startTime = audioContext.currentTime + scheduleAheadMs / 1_000;
  const endTime = startTime + durationMs / 1_000;
  const rampSeconds = Math.min(0.005, durationMs / 4_000);
  const scheduledBeepTsMs = startTime * 1_000;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequencyHz, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + rampSeconds);
  gain.gain.setValueAtTime(gainValue, endTime - rampSeconds);
  gain.gain.linearRampToValueAtTime(0, endTime);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  vadNode.port.postMessage({ type: "reset" });

  return new Promise<CalibrationSample>((resolve, reject) => {
    const cleanup = (): void => {
      globalThis.clearTimeout(timeoutId);
      vadNode.port.removeEventListener("message", onMessage);
      oscillator.disconnect();
      gain.disconnect();
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isVadOnsetMessage(event.data) || event.data.tsMs < scheduledBeepTsMs) {
        return;
      }

      cleanup();
      resolve({ scheduledBeepTsMs, detectedEchoTsMs: event.data.tsMs });
    };
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("calibration beep was not detected before timeout"));
    }, timeoutMs);

    vadNode.port.addEventListener("message", onMessage);
    vadNode.port.start();
    oscillator.start(startTime);
    oscillator.stop(endTime);
  });
}
