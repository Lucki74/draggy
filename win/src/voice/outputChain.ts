/** The path a voice takes to the speakers: rumble out, a little vocoder harshness tamed, gentle
 * compression, a limiter for the peaks, then the gain that ducks and cancels. */

export interface OutputChain {
  /** Connect voice sources here. */
  input: AudioNode;
  /** Duck and cancel ramps act on this. */
  gain: GainNode;
  dispose: () => void;
}

export function createOutputChain(context: AudioContext): OutputChain {
  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 70;

  const harshness = context.createBiquadFilter();
  harshness.type = "peaking";
  harshness.frequency.value = 6000;
  harshness.Q.value = 0.8;
  harshness.gain.value = -2;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.ratio.value = 2;
  compressor.knee.value = 10;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.15;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.ratio.value = 20;
  limiter.knee.value = 0;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.05;

  const gain = context.createGain();
  gain.gain.value = 1;

  highPass.connect(harshness);
  harshness.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(gain);
  gain.connect(context.destination);

  return {
    input: highPass,
    gain,
    dispose() {
      for (const node of [highPass, harshness, compressor, limiter, gain]) node.disconnect();
    },
  };
}
