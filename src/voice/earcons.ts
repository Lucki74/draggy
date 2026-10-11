/** Interface sounds: short struck-bar chimes baked offline by scripts/make-earcons.mjs. They play
 * through the same output chain as the voice, so they sit at the same level and obey the same limiter. */
import { createOutputChain } from "./outputChain";
import { loggedFetch, swallowed } from "../logger";

export type Earcon = "ready" | "ended" | "mute" | "unmute" | "error";

export interface EarconPlayer {
  play: (name: Earcon) => void;
  dispose: () => void;
}

export function createEarconPlayer(context: AudioContext): EarconPlayer {
  const chain = createOutputChain(context);
  const buffers = new Map<Earcon, Promise<AudioBuffer | null>>();

  const load = (name: Earcon) => {
    let pending = buffers.get(name);
    if (!pending) {
      pending = loggedFetch(`./sounds/${name}.wav`)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .catch(swallowed("voice", "audio is best effort", null));
      buffers.set(name, pending);
    }
    return pending;
  };

  return {
    play(name) {
      void load(name).then((buffer) => {
        if (!buffer) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(chain.input);
        source.start();
      });
    },
    dispose() {
      chain.dispose();
    },
  };
}
