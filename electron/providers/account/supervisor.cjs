/** Keeps one account runtime alive only while it is wanted: started on first use, stopped after ten idle
 * minutes or on quit, restarted after a crash with backoff, and given up on after the third. */

const IDLE_MS = 10 * 60 * 1000;
const BACKOFF_MS = [1000, 4000, 16000];

class RuntimeUnavailable extends Error {
  constructor(message) {
    super(message);
    this.code = "account-runtime-unavailable";
  }
}

/** `start(onExit)` resolves to something with `stop()`; the runtime calls `onExit` when its process goes away. */
function createSupervisor({
  start,
  idleMs = IDLE_MS,
  backoffMs = BACKOFF_MS,
  timers = { setTimeout, clearTimeout },
  sleep = (ms) => new Promise((resolve) => timers.setTimeout(resolve, ms)),
  onState = () => {},
}) {
  let state = "stopped";
  let current = null;
  let starting = null;
  let users = 0;
  let idleTimer = null;
  let crashes = 0;
  let generation = 0;

  const set = (next) => {
    if (state === next) return;
    state = next;
    onState(next);
  };

  function clearIdle() {
    if (idleTimer) timers.clearTimeout(idleTimer);
    idleTimer = null;
  }

  function crashed(which) {
    if (which !== generation) return;
    current = null;
    clearIdle();
    crashes += 1;
    set(crashes > backoffMs.length ? "unavailable" : "stopped");
  }

  async function launch() {
    const which = ++generation;
    set("starting");
    if (crashes > 0) await sleep(backoffMs[crashes - 1]);
    try {
      const instance = await start(() => crashed(which));
      if (which !== generation) {
        await instance.stop();
        throw new RuntimeUnavailable("The runtime was stopped while it started");
      }
      current = instance;
      set("running");
      return instance;
    } catch (error) {
      if (which === generation) crashed(which);
      throw error instanceof RuntimeUnavailable ? error : Object.assign(new RuntimeUnavailable(error.message), { cause: error });
    }
  }

  /** Hands out the running runtime, starting it if needed; every acquire needs its release. */
  async function acquire() {
    if (state === "unavailable") throw new RuntimeUnavailable("The runtime crashed too often and was given up on");
    users += 1;
    clearIdle();
    try {
      if (current) return current;
      starting ??= launch().finally(() => {
        starting = null;
      });
      return await starting;
    } catch (error) {
      release();
      throw error;
    }
  }

  function release() {
    users = Math.max(0, users - 1);
    if (users > 0 || !current) return;
    clearIdle();
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      void stop();
    }, idleMs);
  }

  /** Stops on purpose, for idle and quit; a stop on purpose is never counted as a crash. */
  async function stop() {
    generation += 1;
    clearIdle();
    const instance = current;
    current = null;
    // A run that lasted until it idled out clears the count, so a crash a week is never three.
    if (state !== "unavailable") {
      if (instance) crashes = 0;
      set("stopped");
    }
    if (instance) await instance.stop();
  }

  /** After the user asks to try again, a runtime given up on gets its three chances back. */
  function reset() {
    crashes = 0;
    if (state === "unavailable") set("stopped");
  }

  return {
    acquire,
    release,
    stop,
    reset,
    get state() {
      return state;
    },
  };
}

module.exports = { createSupervisor, RuntimeUnavailable, IDLE_MS, BACKOFF_MS };
