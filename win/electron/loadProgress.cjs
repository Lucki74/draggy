// Turns what the engine prints into the steps a prompt shows. Every number is one the engine reported:
// the load percent counts its own progress dots, and the reading speed is tokens over elapsed time.

const STEP = 3;

/** Steps of 3 percent, held below 100 so a step never claims to be done before the next one starts. */
const roundDown = (percent) => Math.max(0, Math.min(99, Math.floor(percent / STEP) * STEP));

/** Follows one prompt's wait. `emit` gets { stage, percent?, tokensPerSecond? }. */
function createLoadProgress({ emit, now = Date.now }) {
  let current = null;
  let lastPercent = -1;
  let readStart = null;

  const push = (event) => {
    if (event.stage === current && event.percent === lastPercent && event.tokensPerSecond === undefined) return;
    current = event.stage;
    lastPercent = event.percent ?? -1;
    emit(event);
  };

  return {
    /** Takes a stage the engine log marked. */
    handle(stage) {
      if (stage.stage === "disk") {
        readStart = null;
        push({ stage: "disk" });
      } else if (stage.stage === "loading") {
        push({ stage: "loading", percent: roundDown(stage.percent ?? 0) });
      } else if (stage.stage === "readying") {
        push({ stage: "readying" });
      } else if (stage.stage === "reading") {
        if (stage.percent >= 100) {
          readStart = null;
          push({ stage: "readying" });
          return;
        }
        const at = now();
        if (!readStart) readStart = { at, tokens: stage.tokens ?? 0 };
        const seconds = (at - readStart.at) / 1000;
        const gained = (stage.tokens ?? 0) - readStart.tokens;
        const event = { stage: "reading", percent: roundDown(stage.percent ?? 0) };
        if (seconds > 0 && gained > 0) event.tokensPerSecond = Math.round(gained / seconds);
        if (event.stage === current && event.percent === lastPercent) return;
        current = "reading";
        lastPercent = event.percent;
        emit(event);
      }
    },
    stop() {
      current = null;
      lastPercent = -1;
      readStart = null;
    },
  };
}

module.exports = { createLoadProgress, roundDown, STEP };
