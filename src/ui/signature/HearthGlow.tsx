/** The bottom-edge glow, lit for exactly as long as the microphone is open (R3). */
export function HearthGlow({ lit }: { lit: boolean }) {
  return <div aria-hidden="true" className="hearth-glow" data-lit={lit} />;
}
