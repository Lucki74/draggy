/** Playback on the audio thread for local voices: PCM from the engine goes into a ring buffer and
 * is pulled out a render quantum at a time. See playerRing.ts for the buffer itself. */

import { createPlayerRing } from "./playerRing";
import type { PlayerRing } from "./playerRing";

// The audio worklet scope is not in TypeScript's DOM library.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

export const PLAYER_PROCESSOR = "voice-player";

interface PlayerMessage {
  type?: string;
  samples?: Float32Array;
  rate?: number;
}

class VoicePlayerProcessor extends AudioWorkletProcessor {
  private readonly ring: PlayerRing = createPlayerRing(sampleRate);
  private underruns = 0;
  private idle = true;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as PlayerMessage;
      if (data?.type === "pcm" && data.samples && data.rate) {
        if (!this.ring.write(data.samples, data.rate)) this.port.postMessage({ type: "overflow" });
      }
      if (data?.type === "finish") this.ring.finish();
      if (data?.type === "cancel") this.ring.cancel();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channel = outputs[0]?.[0];
    if (!channel) return true;
    this.ring.process(channel);
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(channel);

    const { underruns } = this.ring.stats();
    if (underruns !== this.underruns) {
      this.underruns = underruns;
      this.port.postMessage({ type: "underrun", count: underruns });
    }
    const idle = this.ring.idle();
    if (idle !== this.idle) {
      this.idle = idle;
      if (idle) this.port.postMessage({ type: "idle" });
    }
    return true;
  }
}

registerProcessor(PLAYER_PROCESSOR, VoicePlayerProcessor);
