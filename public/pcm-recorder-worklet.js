/**
 * Buffers mono Float32 PCM while armed and posts each block to the main
 * thread. The main thread concatenates blocks and encodes a WAV answer clip
 * for the correctness check. Recording is explicitly armed per round so the
 * worklet never captures audio outside a listening window.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;

    this.port.onmessage = (event) => {
      const message = event.data || {};

      if (message.type === "start") {
        this.recording = true;
      }

      if (message.type === "stop") {
        this.recording = false;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }

  process(inputs) {
    if (!this.recording) {
      return true;
    }

    const channel = inputs[0] && inputs[0][0];

    if (channel && channel.length > 0) {
      this.port.postMessage(
        { type: "chunk", samples: channel.slice(0) },
        [],
      );
    }

    return true;
  }
}

registerProcessor("pcm-recorder-worklet", PcmRecorderProcessor);
