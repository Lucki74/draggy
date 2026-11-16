/** WebView2 never starts onnxruntime's pthread workers from inside a worker, so a threaded
 * session waits forever. Every voice worker stays on one thread. */
export function workerThreads(): number {
  return 1;
}
