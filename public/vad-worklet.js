class VadProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const config = options.processorOptions || {};
    this.threshold = this.validThreshold(config.threshold) ? config.threshold : 0.035;
    this.hangoverMs = this.validHangover(config.hangoverMs)
      ? config.hangoverMs
      : 120;
    this.active = false;
    this.lastAboveThresholdMs = Number.NEGATIVE_INFINITY;

    this.port.onmessage = (event) => {
      const message = event.data || {};

      if (message.type === "configure") {
        if (this.validThreshold(message.threshold)) {
          this.threshold = message.threshold;
        }
        if (this.validHangover(message.hangoverMs)) {
          this.hangoverMs = message.hangoverMs;
        }
      }

      if (message.type === "reset") {
        this.active = false;
        this.lastAboveThresholdMs = Number.NEGATIVE_INFINITY;
      }
    };
  }

  validThreshold(value) {
    return Number.isFinite(value) && value > 0 && value <= 1;
  }

  validHangover(value) {
    return Number.isFinite(value) && value >= 0;
  }

  process(inputs) {
    const channels = inputs[0];

    if (!channels || channels.length === 0 || channels[0].length === 0) {
      return true;
    }

    let sumSquares = 0;
    let sampleCount = 0;

    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        const sample = channel[index];
        sumSquares += sample * sample;
      }
      sampleCount += channel.length;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    const tsMs = currentTime * 1_000;

    if (rms >= this.threshold) {
      this.lastAboveThresholdMs = tsMs;

      if (!this.active) {
        this.active = true;
        this.port.postMessage({ type: "onset", tsMs });
      }
    } else if (
      this.active &&
      tsMs - this.lastAboveThresholdMs >= this.hangoverMs
    ) {
      this.active = false;
    }

    return true;
  }
}

registerProcessor("vad-worklet", VadProcessor);
