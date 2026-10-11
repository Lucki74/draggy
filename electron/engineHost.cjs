"use strict";

/**
 * One local inference engine at a time. llama.cpp and colibri each own a process; this host makes
 * sure starting one stops the other, so two models never fight over the same RAM and VRAM.
 */
const { log } = require("./logger.cjs");

function createEngineHost({ llamacpp, colibri }) {
  const engines = { llamacpp, colibri };
  let active = null;

  function stopOthers(kind) {
    for (const [name, engine] of Object.entries(engines)) {
      if (name !== kind) engine.stopSync();
    }
  }

  /** Runs `launch` as the one active engine; on failure nothing is left active. */
  async function start(kind, launch) {
    if (!engines[kind]) {
      const error = new Error(`Unknown engine: ${kind}`);
      log.fail("engine.host", "unknown engine", error, { kind });
      throw error;
    }
    const timer = log.time("engine.host", "engine started", { kind });
    stopOthers(kind);
    active = kind;
    let result;
    try {
      result = await launch();
    } catch (error) {
      timer.fail(error, { kind });
      throw error;
    }
    if (!result?.success && active === kind) active = null;
    timer.end({ success: Boolean(result?.success) });
    return result;
  }

  function stop() {
    for (const engine of Object.values(engines)) engine.stopSync();
    log.debug("engine.host", "engines stopped", { was: active });
    active = null;
  }

  function status() {
    const llama = llamacpp.status();
    const coli = colibri.status();
    if (coli.running) return { kind: "colibri", ...coli };
    if (llama.running) return { kind: "llamacpp", ...llama };
    return { kind: active, running: false, port: null, model: null };
  }

  return { start, stop, stopSync: stop, status, get active() { return active; } };
}

module.exports = { createEngineHost };
