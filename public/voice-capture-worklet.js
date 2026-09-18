/** Mic capture on the audio thread, so UI renders cannot drop frames where speech starts.
 * 512-sample frames (Silero at 16 kHz) are exactly four 128-sample quanta. */

const FRAME = 512;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME);
    this.filled = 0;
    this.muted = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === "mute") this.muted = Boolean(event.data.value);
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(FRAME - this.filled, input.length - offset);
      this.buffer.set(input.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled < FRAME) continue;

      const frame = this.buffer;
      this.buffer = new Float32Array(FRAME);
      this.filled = 0;

      let energy = 0;
      for (let i = 0; i < FRAME; i++) energy += frame[i] * frame[i];

      // The buffer is transferred rather than copied, so no allocation churn
      // reaches the audio thread's deadline.
      this.port.postMessage(
        {
          frame: frame.buffer,
          level: Math.sqrt(energy / FRAME),
          muted: this.muted,
        },
        [frame.buffer],
      );
    }

    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
