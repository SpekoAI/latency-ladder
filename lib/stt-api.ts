export const MAX_AUDIO_DURATION_MS = 10_000;
// Ten seconds of 48 kHz, stereo, signed 16-bit PCM plus a WAV header.
export const MAX_AUDIO_BYTES = 48_000 * 2 * 2 * 10 + 44;

interface SseEvent {
  event: string;
  data: string;
}

export interface SttHandlerDependencies {
  fetchImpl: typeof fetch;
  now: () => number;
  getConfig: () => {
    apiKey: string | undefined;
    apiBaseUrl: string | undefined;
  };
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseSseEvents(source: string): SseEvent[] {
  const events: SseEvent[] = [];
  let event = "message";
  let data: string[] = [];

  const dispatch = (): void => {
    if (data.length > 0) {
      events.push({ event, data: data.join("\n") });
    }
    event = "message";
    data = [];
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line === "") {
      dispatch();
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  dispatch();

  return events;
}

export function parseTranscriptionSse(source: string): string {
  let finalText: string | null = null;
  let sawDone = false;

  for (const event of parseSseEvents(source)) {
    if (!["meta", "transcript", "done", "error"].includes(event.event)) {
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      throw new Error("Malformed Speko transcription event");
    }

    if (!data || typeof data !== "object") {
      throw new Error("Malformed Speko transcription event");
    }

    if (event.event === "error") {
      throw new Error("Speko transcription stream reported an error");
    }

    if (event.event === "done") {
      const text = (data as Record<string, unknown>).text;
      if (typeof text !== "string") {
        throw new Error("Malformed Speko done event");
      }
      finalText = text;
      sawDone = true;
    }
  }

  if (!sawDone || finalText === null) {
    throw new Error("Speko transcription stream ended without done");
  }

  return finalText;
}

function validateDeclaredDuration(request: Request): "missing" | "invalid" | null {
  const value = request.headers.get("x-audio-duration-ms");
  if (value === null) {
    return "missing";
  }

  const durationMs = Number(value);
  return !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_AUDIO_DURATION_MS
    ? "invalid"
    : null;
}

export function createSttCheckHandler(
  dependencies: SttHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const { apiKey, apiBaseUrl } = dependencies.getConfig();
    if (!apiKey?.trim() || !apiBaseUrl?.trim()) {
      return jsonError("Speko server configuration is missing", 500);
    }

    const durationError = validateDeclaredDuration(request);
    if (durationError === "missing") {
      return jsonError("x-audio-duration-ms is required", 400);
    }
    if (durationError === "invalid") {
      return jsonError("Audio chunk must be 10 seconds or shorter", 413);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
      return jsonError("Audio chunk is too large", 413);
    }

    const audio = await request.arrayBuffer();
    if (audio.byteLength === 0) {
      return jsonError("Audio chunk is empty", 400);
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      return jsonError("Audio chunk is too large", 413);
    }

    const startedAtMs = dependencies.now();
    let upstream: Response;
    try {
      upstream = await dependencies.fetchImpl(
        `${apiBaseUrl.replace(/\/+$/, "")}/v1/transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/octet-stream",
            "x-speko-intent": JSON.stringify({ language: "en" }),
          },
          body: audio,
          signal: request.signal,
        },
      );
    } catch {
      return jsonError("Unable to transcribe audio", 502);
    }

    if (!upstream.ok) {
      return jsonError("Unable to transcribe audio", 502);
    }

    let text: string;
    try {
      text = parseTranscriptionSse(await upstream.text());
    } catch {
      return jsonError("Invalid transcription response", 502);
    }

    return Response.json(
      {
        text,
        msElapsed: Math.max(0, Math.round(dependencies.now() - startedAtMs)),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  };
}
