import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { QUESTIONS } from "../lib/questions";

const SAMPLE_RATE_HZ = 24_000;
const CHANNEL_COUNT = 1;
const BITS_PER_SAMPLE = 16;

// PLACEHOLDER-CASTING: Blake is the catalog's explicitly energetic American
// voice. Revisit casting after product voice direction and listening tests.
const VOICE_ID = "a167e0f3-df7e-4d52-a9c3-f949145efdab";
const VOICE_NAME = "Blake (energetic American male)";

interface SynthesisMetric {
  id: string;
  voice: string;
  provider: string | null;
  model: string | null;
  providerFirstByteMs: number | null;
  responseHeadersMs: number;
  totalElapsedMs: number;
  audioDurationMs: number;
  pcmBytes: number;
}

function requireEnv(name: "SPEKO_API_BASE" | "SPEKO_API_KEY"): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value.replace(/\/$/, "");
}

function parseOptionalNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function pcm16ToWav(pcm: Uint8Array, sampleRateHz = SAMPLE_RATE_HZ): Uint8Array {
  if (pcm.byteLength % 2 !== 0) {
    throw new Error("PCM16 payload must contain an even number of bytes");
  }

  const headerBytes = 44;
  const output = new Uint8Array(headerBytes + pcm.byteLength);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      output[offset + index] = value.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNEL_COUNT, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * CHANNEL_COUNT * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, CHANNEL_COUNT * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  output.set(pcm, headerBytes);

  return output;
}

async function synthesizeQuestion(
  apiBase: string,
  apiKey: string,
  question: (typeof QUESTIONS)[number],
): Promise<{ wav: Uint8Array; metric: SynthesisMetric }> {
  const requestStartedAt = performance.now();
  const response = await fetch(`${apiBase}/v1/synthesize`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: question.prompt,
      intent: { language: "en", optimizeFor: "latency" },
      voice: VOICE_ID,
    }),
  });
  const responseHeadersMs = performance.now() - requestStartedAt;

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Synthesis failed for ${question.id}: ${response.status} ${message}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("audio/pcm") || !contentType.includes("rate=24000")) {
    throw new Error(`Expected raw PCM at 24000 Hz, received ${contentType || "unknown"}`);
  }

  const pcm = new Uint8Array(await response.arrayBuffer());
  const totalElapsedMs = performance.now() - requestStartedAt;
  const audioDurationMs =
    (pcm.byteLength / (SAMPLE_RATE_HZ * CHANNEL_COUNT * (BITS_PER_SAMPLE / 8))) *
    1_000;

  return {
    wav: pcm16ToWav(pcm),
    metric: {
      id: question.id,
      voice: VOICE_NAME,
      provider: response.headers.get("x-speko-provider"),
      model: response.headers.get("x-speko-model"),
      providerFirstByteMs: parseOptionalNumber(
        response.headers.get("x-speko-first-byte-ms"),
      ),
      responseHeadersMs: Math.round(responseHeadersMs),
      totalElapsedMs: Math.round(totalElapsedMs),
      audioDurationMs: Math.round(audioDurationMs),
      pcmBytes: pcm.byteLength,
    },
  };
}

async function main(): Promise<void> {
  const apiBase = requireEnv("SPEKO_API_BASE");
  const apiKey = requireEnv("SPEKO_API_KEY");
  const outputDirectory = join(process.cwd(), "public", "questions");
  const metrics: SynthesisMetric[] = [];

  await mkdir(outputDirectory, { recursive: true });

  for (const question of QUESTIONS) {
    const { wav, metric } = await synthesizeQuestion(apiBase, apiKey, question);
    await Bun.write(join(outputDirectory, `${question.id}.wav`), wav);
    metrics.push(metric);
    console.log(JSON.stringify(metric));
  }

  const firstByteValues = metrics.flatMap(({ providerFirstByteMs }) =>
    providerFirstByteMs === null ? [] : [providerFirstByteMs],
  );

  console.log(
    JSON.stringify({
      count: metrics.length,
      voice: VOICE_NAME,
      firstByteMs: firstByteValues,
      meanFirstByteMs:
        firstByteValues.length === 0
          ? null
          : Math.round(
              firstByteValues.reduce((sum, value) => sum + value, 0) /
                firstByteValues.length,
            ),
    }),
  );
}

if (import.meta.main) {
  await main();
}
