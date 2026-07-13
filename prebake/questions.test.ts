import { describe, expect, test } from "bun:test";

import { pcm16ToWav } from "./questions";

describe("pcm16ToWav", () => {
  test("wraps little-endian PCM16 in a mono WAV header", () => {
    const wav = pcm16ToWav(new Uint8Array([1, 2, 3, 4]));
    const text = new TextDecoder().decode(wav);
    const view = new DataView(wav.buffer);

    expect(text.slice(0, 4)).toBe("RIFF");
    expect(text.slice(8, 12)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(Array.from(wav.slice(44))).toEqual([1, 2, 3, 4]);
  });

  test("rejects incomplete PCM16 samples", () => {
    expect(() => pcm16ToWav(new Uint8Array([1]))).toThrow(
      "PCM16 payload must contain an even number of bytes",
    );
  });
});
