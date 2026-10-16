/** OpenAI speech over the user's own key. The request is made here, in the main process; the renderer
 * only ever receives PCM frames. Nothing about the text or the audio is logged beyond its size. */

const { createFramer, SAMPLE_RATE, FRAME_BYTES } = require("./frames.cjs");
const { log } = require("../../logger.cjs");

const STYLE = "Speak warmly and relaxed, like a person in a conversation, with natural pauses.";
const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "alloy";
const MAX_CHARS = 4000;

const capabilities = {
  id: "openai",
  sampleRate: SAMPLE_RATE,
  streamingText: false,
  conditionsOnContext: false,
  nativeCues: {},
};

function buildRequest({ baseUrl, apiKey, headers }, { text, voice, model }) {
  const input = String(text || "").slice(0, MAX_CHARS);
  if (!input.trim()) throw new Error("There is nothing to speak.");
  return {
    url: `${baseUrl}/audio/speech`,
    init: {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        voice: voice || DEFAULT_VOICE,
        input,
        instructions: STYLE,
        response_format: "pcm",
      }),
    },
  };
}

/** Streams one fragment as 40 ms Int16 frames. A trailing odd byte is carried to the next chunk so a
 * sample is never split. Resolves with the character and frame counts. */
async function speak(connection, request, { fetchImpl = fetch, signal, onFrames } = {}) {
  if (!connection?.apiKey) throw Object.assign(new Error("No key for this provider."), { code: "no-key" });
  const built = buildRequest(connection, request);
  const response = await fetchImpl(built.url, { ...built.init, signal });
  if (!response.ok) {
    const failure = Object.assign(new Error(`The voice service answered ${response.status}.`), { code: `http-${response.status}` });
    log.fail("providers.openai", "speech request failed", failure, { status: response.status });
    throw failure;
  }

  const framer = createFramer(onFrames);
  const reader = response.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    framer.push(value);
  }
  const frames = framer.end();
  const characters = String(request.text).length;
  log.debug("providers.openai", "speech done", { characters, frames, bytes, status: response.status });
  return { characters, frames };
}

module.exports = { capabilities, buildRequest, speak, SAMPLE_RATE, FRAME_BYTES };
