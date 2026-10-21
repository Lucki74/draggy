const fs = require("fs");
const path = require("path");

// The engine prints no progress while it reads or places the weights, so those stages get an
// estimate from how long the same stage took last time. The prompt stage reports a real fraction.

const TICK_MS = 400;
const STEP = 3;
/** Seconds per GB when this model has not loaded before. */
const FIRST_LOAD_SECONDS_PER_GB = { reading: 1, placing: 0.5 };

const roundDown = (percent) => Math.max(0, Math.min(100, Math.floor(percent / STEP) * STEP));

function readHistory(file, logger) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") logger.warn("llama.load", `load times unreadable: ${error.name}`);
    return {};
  }
}

/** Follows one model load. `emit` gets { stage, percent } at most once per 3 percent. */
function createLoadProgress({ modelPath, sizeBytes, userDataDir, emit, logger, now = Date.now, setTick = setInterval, clearTick = clearInterval }) {
  const file = userDataDir ? path.join(userDataDir, "load-times.json") : null;
  const history = file ? readHistory(file, logger) : {};
  const known = (history[modelPath] ??= {});
  const gb = Math.max(0.1, (sizeBytes || 0) / 1024 ** 3);

  let current = null;
  let startedAt = 0;
  let lastPercent = -1;
  let timer = null;

  const push = (stage, percent) => {
    const rounded = roundDown(percent);
    if (stage === current && rounded === lastPercent) return;
    lastPercent = rounded;
    emit({ stage, percent: rounded });
  };

  const expectedMs = (stage) => known[stage] ?? gb * (FIRST_LOAD_SECONDS_PER_GB[stage] ?? 1) * 1000;

  const finish = () => {
    if (timer) clearTick(timer);
    timer = null;
    if (!current) return;
    const durMs = now() - startedAt;
    // The prompt stage repeats with every request, so only the two load stages are timed.
    if (current === "reading" || current === "placing") {
      logger.info("llama.load", "stage done", { stage: current, durMs });
      known[current] = durMs;
    }
    current = null;
  };

  const save = () => {
    if (!file) return;
    try {
      fs.writeFileSync(file, JSON.stringify(history));
    } catch (error) {
      logger.warn("llama.load", `load times not saved: ${error.name}`);
    }
  };

  return {
    /** Takes a stage the engine log marked. */
    handle(stage) {
      if (stage.stage === current && stage.stage !== "prefilling") return;
      if (stage.stage === "prefilling") {
        if (current !== "prefilling") {
          finish();
          current = "prefilling";
          startedAt = now();
          lastPercent = -1;
        }
        push("prefilling", stage.percent ?? 0);
        return;
      }
      finish();
      if (stage.stage === "ready") {
        save();
        emit({ stage: "ready" });
        return;
      }
      current = stage.stage;
      startedAt = now();
      lastPercent = -1;
      push(current, 0);
      const expected = expectedMs(current);
      // Held below 99 so a slower load than last time never claims to be done early.
      timer = setTick(() => push(current, Math.min(99, ((now() - startedAt) / expected) * 100)), TICK_MS);
      timer.unref?.();
    },
    stop() {
      finish();
    },
  };
}

module.exports = { createLoadProgress, roundDown, STEP };
