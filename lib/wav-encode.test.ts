import { describe, expect, test } from "bun:test";

import { encodeWavPcm16 } from "./wav-encode";

describe("encodeWavPcm16", () => {
  test("writes a valid RIFF header and sample data", () => {
    const chunk = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWavPcm16([chunk], 48_000);
    const view = new DataView(wav.buffer);

    expect(String.fromCharCode(wav[0], wav[1], wav[2], wav[3])).toBe("RIFF");
    expect(String.fromCharCode(wav[8], wav[9], wav[10], wav[11])).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(chunk.length * 2);
    expect(wav.byteLength).toBe(44 + chunk.length * 2);

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(view.getInt16(50, true)).toBe(0x7fff);
    expect(view.getInt16(52, true)).toBe(-0x8000);
  });

  test("concatenates chunks in order and clamps overdrive", () => {
    const wav = encodeWavPcm16(
      [new Float32Array([2]), new Float32Array([-2])],
      16_000,
    );
    const view = new DataView(wav.buffer);

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  test("rejects invalid sample rates", () => {
    expect(() => encodeWavPcm16([], 0)).toThrow(RangeError);
  });
});
