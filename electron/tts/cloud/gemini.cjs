/** Gemini speech over the user's own key: a streaming generateContent call that asks for audio. Each
 * server event carries base64 PCM at 24 kHz. Runs in the main process only. */
const { createFramer, SAMPLE_RATE } = require("./frames.cjs");
const { log } = require("../../logger.cjs");

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Kore";
const MAX_CHARS = 4000;
const STYLE = "Say this warmly and relaxed, like a person in a conversation, with natural pauses: ";

const capabilities = {
  id: "gemini",
  sampleRate: SAMPLE_RATE,
  streamingText: false,
  conditionsOnContext: false,
  nativeCues: {},
};

function buildRequest({ baseUrl, apiKey, headers }, { text, voice, model }) {
  const input = String(text || "").slice(0, MAX_CHARS);
  if (!input.trim()) throw new Error("There is nothing to speak.");
  return {
    url: `${baseUrl}/models/${encodeURIComponent(model || DEFAULT_MODEL)}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: STYLE + input }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || DEFAULT_VOICE } } },
        },
      }),
    },
  };
}

/** The audio in one server event, or null. */
function audioOf(data) {
  try {
    const parts = JSON.parse(data)?.candidates?.[0]?.content?.parts ?? [];
    const part = parts.find((p) => p.inlineData?.data);
    return part ? Buffer.from(part.inlineData.data, "base64") : null;
  } catch {
    log.swallow("providers.gemini", undefined, "audio event is not json");
    return null;
  }
}

async function speak(connection, request, { fetchImpl = fetch, signal, onFrames } = {}) {
  if (!connection?.apiKey) throw Object.assign(new Error("No key for this provider."), { code: "no-key" });
  const built = buildRequest(connection, request);
  const timer = log.time("providers.gemini", "speech", { model: request.model || DEFAULT_MODEL, chars: String(request.text).length });
  let response;
  try {
    response = await fetchImpl(built.url, { ...built.init, signal });
  } catch (error) {
    log.fail("providers.gemini", "speech request failed", error);
    throw error;
  }
  if (!response.ok) {
    log.fail("providers.gemini", "speech refused", null, { status: response.status });
    throw Object.assign(new Error(`The voice service answered ${response.status}.`), { code: `http-${response.status}` });
  }

  const framer = createFramer(onFrames);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let text = "";
  const drain = (final) => {
    const lines = text.split("\n");
    text = final ? "" : lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const audio = audioOf(line.slice(5).trim());
      if (audio) framer.push(audio);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    drain(false);
  }
  drain(true);
  const frames = framer.end();
  timer.end({ frames });
  return { characters: String(request.text).length, frames };
}

module.exports = { capabilities, buildRequest, speak };
