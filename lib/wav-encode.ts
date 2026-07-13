/**
 * Encodes mono Float32 PCM chunks into a 16-bit PCM WAV file. Used to ship
 * short answer clips to /api/stt-check without gambling on container support
 * upstream: raw WAV is the format the transcription API is proven against.
 */
export function encodeWavPcm16(
  chunks: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a positive finite number");
  }

  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}
