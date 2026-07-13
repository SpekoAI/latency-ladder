# Day 1 Speko timing spike

Date: 2026-07-12

## Verdict: FALLBACK

Build the fallback architecture for the timed rounds. The live browser client can
join a cascade session and exposes useful transcript and coarse speaking-state
events, but its public API does not expose the remote audio track, audio element,
sample clock, playback start, or playback end. A transcript receive time or
active-speaker transition is not a defensible substitute for the instant the
last question sample reached the user's speakers.

The fallback keeps the product claim intact:

1. Play the eight pre-baked questions locally and timestamp each local playback
   end on the browser clock.
2. Run microphone samples through the local AudioWorklet VAD. The user's number
   is question playback end to first local speech onset, with no network event in
   that interval.
3. Send at most 10 seconds of answer audio to `/api/stt-check` only for the
   correctness gate.
4. Run one real live Speko session turn during the run and show the agent's
   separately measured latency. Do not fold that network measurement into the
   human number.

The primary architecture can be reconsidered if the browser client adds public
remote-track or playout callbacks with audio-clock timestamps.

## Package inspection

Installed versions:

- `@spekoai/client@0.0.9`
- `@spekoai/sdk@0.5.1`

Relevant evidence from the installed declarations and implementation:

- `VoiceConversation.create` accepts `transportToken` and `transportUrl`.
- `ConversationCallbacks` includes `onMessage`, `onTranscript`, and
  `onModeChange`, but no track or playback-timestamp callback.
- `ConversationMessage.startedAt` is documented as the wall-clock time when the
  transport first received a transcript segment. It is not an audio playout
  timestamp.
- `onModeChange` reports only `listening` or `speaking`. The implementation
  derives this from LiveKit `ActiveSpeakersChanged`, which is not guaranteed to
  coincide with audible sample end.
- The internal `WebRTCConnection` has a LiveKit `Room`, attaches remote tracks
  to private audio elements, and handles track subscription internally.
  `WebRTCConnection` is not exported by the package root, and the package export
  map exposes only the root module.
- The server SDK realtime API exposes raw audio frames for `s2s`, but the product
  uses a `cascade` browser session and `VoiceConversation`.

Inspected files:

- `node_modules/@spekoai/client/dist/types.d.ts`
- `node_modules/@spekoai/client/dist/voice-conversation.d.ts`
- `node_modules/@spekoai/client/dist/webrtc-connection.d.ts`
- `node_modules/@spekoai/client/dist/webrtc-connection.js`
- `node_modules/@spekoai/client/package.json`
- `node_modules/@spekoai/sdk/dist/lib/types/index.d.ts`

## Real session mint

A real request was sent to `POST /v1/sessions` with Bearer authentication,
`mode: "cascade"`, an English latency-optimized intent, the scripted quizmaster
prompt, spike metadata, and a 120 second TTL.

Observed result:

- HTTP status: `201`
- request elapsed time: `1826 ms`
- response keys: `mode`, `sessionId`, `transportToken`, `transportUrl`,
  `conversationToken`, `livekitUrl`, `roomName`, `identity`, `expiresAt`
- all returned values were strings
- `transportUrl` and `livekitUrl` pointed to the same LiveKit host
- `transportToken` was 568 characters and was not stored

The response therefore supplies the current primary credential names plus the
documented legacy credential aliases. No API key or transport token is committed.

## Scripted quizmaster prompt

The live session spike used this short prompt:

> You are a scripted quizmaster. Ask exactly one short question at a time,
> starting with: What is seven plus eight? Wait for the answer. Be crisp and do
> not add commentary.

The deterministic timed rounds use the pre-baked question files rather than
depending on live model wording or live TTS duration.

## Pre-bake synthesis measurements

The eight prompts were synthesized with Cartesia `sonic-3.5` using Blake
(`a167e0f3-df7e-4d52-a9c3-f949145efdab`), selected heuristically because the
voice catalog labels it energetic. This is marked `PLACEHOLDER-CASTING` in the
script and is not a final product casting decision.

The `x-speko-first-byte-ms` measurements were:

| Asset | First byte | Request total | Audio duration |
| --- | ---: | ---: | ---: |
| `q1.wav` | 295 ms | 1524 ms | 1194 ms |
| `q2.wav` | 122 ms | 1040 ms | 1434 ms |
| `q3.wav` | 128 ms | 1052 ms | 1514 ms |
| `q4.wav` | 81 ms | 528 ms | 1434 ms |
| `q5.wav` | 128 ms | 1077 ms | 1834 ms |
| `q6.wav` | 77 ms | 584 ms | 1754 ms |
| `q7.wav` | 128 ms | 704 ms | 2234 ms |
| `q8.wav` | 76 ms | 939 ms | 1354 ms |

Mean provider first byte was 129 ms; median was 125 ms. The colder first call
was 295 ms. Request totals include network transfer and full response download,
so they are not used as the agent latency measurement.

## Transcription transport check

One generated WAV was sent to `POST /v1/transcribe` as
`application/octet-stream` with `x-speko-intent: {"language":"en"}`. The API
returned `200 text/event-stream` in 746 ms. Its event order was `meta`,
`transcript`, `done`; the final text was `What is 7 plus 8?`. This confirms the
SSE parser used by `/api/stt-check` against the live response format.

The completed `/api/stt-check` handler was then invoked with the same 1194 ms
WAV and its required duration header. It returned `200` with the same text and
`msElapsed: 743`.
