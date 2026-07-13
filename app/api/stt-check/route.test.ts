import { describe, expect, test } from "bun:test";

import { createSttCheckHandler, parseTranscriptionSse } from "@/lib/stt-api";

const completedSse = [
  "event: meta",
  'data: {"provider":"test","model":"fast"}',
  "",
  "event: transcript",
  'data: {"text":"fif","isFinal":false,"confidence":0.7}',
  "",
  "event: done",
  'data: {"text":"fifteen","provider":"test","model":"fast"}',
  "",
].join("\r\n");

describe("parseTranscriptionSse", () => {
  test("parses meta, transcript, and done events with CRLF framing", () => {
    expect(parseTranscriptionSse(completedSse)).toBe("fifteen");
  });

  test("requires a valid done event", () => {
    expect(() =>
      parseTranscriptionSse('event: transcript\ndata: {"text":"partial"}\n\n'),
    ).toThrow("ended without done");
    expect(() => parseTranscriptionSse("event: done\ndata: nope\n\n")).toThrow(
      "Malformed",
    );
  });
});

describe("stt-check POST handler", () => {
  test("proxies binary audio and returns final text with elapsed time", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const times = [100, 143];
    const handler = createSttCheckHandler({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(completedSse, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }) as unknown as typeof fetch,
      now: () => times.shift() ?? 143,
      getConfig: () => ({ apiKey: "server-secret", apiBaseUrl: "https://api.test/" }),
    });
    const audio = new Uint8Array([1, 2, 3, 4]);

    const response = await handler(
      new Request("http://localhost/api/stt-check", {
        method: "POST",
        headers: { "x-audio-duration-ms": "9000" },
        body: audio,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "fifteen", msElapsed: 43 });
    expect(capturedUrl).toBe("https://api.test/v1/transcribe");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer server-secret",
      "Content-Type": "application/octet-stream",
      "x-speko-intent": '{"language":"en"}',
    });
    expect(Array.from(new Uint8Array(capturedInit?.body as ArrayBuffer))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  test("rejects declared audio longer than ten seconds before proxying", async () => {
    let called = false;
    const handler = createSttCheckHandler({
      fetchImpl: (async () => {
        called = true;
        return new Response(completedSse);
      }) as unknown as typeof fetch,
      now: () => 0,
      getConfig: () => ({ apiKey: "secret", apiBaseUrl: "https://api.test" }),
    });

    const response = await handler(
      new Request("http://localhost/api/stt-check", {
        method: "POST",
        headers: { "x-audio-duration-ms": "10001" },
        body: new Uint8Array([1]),
      }),
    );

    expect(response.status).toBe(413);
    expect(called).toBe(false);
  });

  test("requires an explicit audio duration", async () => {
    let called = false;
    const handler = createSttCheckHandler({
      fetchImpl: (async () => {
        called = true;
        return new Response(completedSse);
      }) as unknown as typeof fetch,
      now: () => 0,
      getConfig: () => ({ apiKey: "secret", apiBaseUrl: "https://api.test" }),
    });

    const response = await handler(
      new Request("http://localhost/api/stt-check", {
        method: "POST",
        body: new Uint8Array([1]),
      }),
    );

    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });
});
