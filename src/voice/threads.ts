/** WASM threads need a cross-origin isolated page; without one a worker must stay on a single
 * thread. Half the cores, at most four, so audio and the interface keep theirs. */
export function wasmThreads(isolated: boolean, cores: number): number {
  if (!isolated) return 1;
  return Math.min(4, Math.max(1, Math.floor(cores / 2)));
}

export function workerThreads(): number {
  return wasmThreads(
    typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1,
  );
}
