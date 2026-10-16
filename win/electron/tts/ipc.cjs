/** Cloud voices for the renderer. The request is made here with the provider's stored key; the page
 * gets frames, counts and codes, never the key and never an echo of the text. Frames carry the turn
 * id, so one that arrives after a cancel is recognisable and dropped. */
const openai = require("./cloud/openai.cjs");
const gemini = require("./cloud/gemini.cjs");
const { log } = require("../logger.cjs");

const ADAPTERS = { openai, gemini };

/** The providers a cloud voice can use: the adapter's id is the provider's catalog id. */
function cloudProviders(registry) {
  return Object.keys(ADAPTERS).map((id) => {
    const connection = registry.connectionFor(id);
    return { id, name: id === "openai" ? "OpenAI" : "Google Gemini", configured: Boolean(connection?.apiKey), instance: connection ? id : null };
  });
}

function createTtsHandlers({ registry, consent, send, fetchImpl = fetch }) {
  const live = new Map();

  return {
    "tts:providers": () => ({ providers: cloudProviders(registry), consent: consent.list() }),
    "tts:consent-grant": (provider) => {
      if (!ADAPTERS[provider]) return { success: false, code: "unknown-provider" };
      consent.grant(provider);
      return { success: true };
    },
    "tts:consent-revoke": (provider) => {
      consent.revoke(provider);
      return { success: true };
    },

    /** Starts one fragment. Frames come back on `tts:frames`; the answer is the final count. */
    "tts:speak": async (turnId, request) => {
      const provider = String(request?.provider || "");
      const adapter = ADAPTERS[provider];
      if (!adapter) return { success: false, code: "unknown-provider" };
      if (!consent.has(provider)) return { success: false, code: "no-consent" };
      const connection = registry.connectionFor(provider);
      if (!connection?.apiKey) return { success: false, code: "no-key" };

      log.debug("ipc.tts", "engine chosen", { provider, chars: String(request?.text ?? "").length });
      const timer = log.time("ipc.tts", "synthesis", { provider, turnId });
      const controller = new AbortController();
      const set = live.get(turnId) ?? new Set();
      set.add(controller);
      live.set(turnId, set);
      try {
        const result = await adapter.speak(connection, request, {
          fetchImpl,
          signal: controller.signal,
          onFrames: (pcm) => send("tts:frames", { turnId, pcm, sampleRate: adapter.capabilities.sampleRate }),
        });
        timer.end({ characters: result.characters, frames: result.frames });
        return { success: true, characters: result.characters, frames: result.frames, provider };
      } catch (error) {
        if (error?.name === "AbortError") {
          timer.end({ status: "cancelled" });
          return { success: false, code: "cancelled" };
        }
        timer.fail(error, { code: error?.code });
        return { success: false, code: error?.code || "failed" };
      } finally {
        set.delete(controller);
        if (set.size === 0) live.delete(turnId);
      }
    },

    "tts:cancel": (turnId) => {
      for (const controller of live.get(turnId) ?? []) controller.abort();
      live.delete(turnId);
      return { success: true };
    },
  };
}

module.exports = { createTtsHandlers, ADAPTERS };
