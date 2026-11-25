import type { EngineOptions, VoiceEngine } from "./voiceEngine";
import { logRendererEvent } from "../logger";

/** The system voice: free, instant, every installed language, and the default. Chromium stalls it
 * after fifteen seconds and truncates long utterances. */

const VOICE_LANGUAGES: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ru: "ru-RU",
};

/** Names that mark a voice as one of the newer neural ones. */
const NATURAL_HINTS = ["natural", "neural", "online", "premium", "enhanced"];

/** How often to poke a synthesiser that Chromium may have stalled. */
const WATCHDOG_MS = 5000;

export function voiceScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (NATURAL_HINTS.some((hint) => name.includes(hint))) score += 100;
  if (voice.localService) score += 10;
  if (voice.default) score += 1;
  return score;
}

export function isSystemVoiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listVoices(language: string): SpeechSynthesisVoice[] {
  if (!isSystemVoiceSupported()) return [];
  const prefix = (VOICE_LANGUAGES[language] || "en-US").slice(0, 2);
  return speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.replace("_", "-").startsWith(prefix))
    .sort((a, b) => voiceScore(b) - voiceScore(a));
}

export function createSystemVoice(options: EngineOptions): VoiceEngine {
  const tag = VOICE_LANGUAGES[options.language] || "en-US";

  let queued = 0;
  let speaking = false;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  const pickVoice = () => {
    const voices = listVoices(options.language);
    return voices.find((voice) => voice.name === options.voice) || voices[0] || null;
  };

  const setSpeaking = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    options.onSpeakingChange(value);
  };

  const startWatchdog = () => {
    if (watchdog) return;
    watchdog = setInterval(() => {
      if (speechSynthesis.speaking && speechSynthesis.paused) {
        logRendererEvent("renderer.voice", "DEBUG", "system voice resumed after stall");
        speechSynthesis.resume();
      }
    }, WATCHDOG_MS);
  };

  const stopWatchdog = () => {
    if (!watchdog) return;
    clearInterval(watchdog);
    watchdog = null;
  };

  const settleIfIdle = () => {
    if (queued === 0) {
      stopWatchdog();
      setSpeaking(false);
    }
  };

  const speak = (text: string) => {
    const mine = generation;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || tag;
    utterance.rate = options.rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    queued++;
    setSpeaking(true);
    startWatchdog();

    const done = () => {
      if (mine !== generation) return;
      queued = Math.max(0, queued - 1);
      settleIfIdle();
    };
    utterance.onend = done;
    utterance.onerror = (event) => {
      // Cancelling a queue reports every dropped utterance as canceled or interrupted; only real failures are worth a line.
      if (event.error !== "canceled" && event.error !== "interrupted") {
        logRendererEvent("renderer.voice", "WARN", "system utterance failed", { code: event.error });
      }
      done();
    };
    logRendererEvent("renderer.voice", "DEBUG", "system fragment queued", { chars: text.length, voice: Boolean(voice), queued });
    speechSynthesis.speak(utterance);
  };

  return {
    id: "system",

    enqueue(text) {
      const trimmed = text.trim();
      if (!trimmed || !isSystemVoiceSupported()) return;
      speak(trimmed);
    },

    cancel() {
      logRendererEvent("renderer.voice", "DEBUG", "system voice cancelled", { queued });
      generation++;
      queued = 0;
      stopWatchdog();
      if (isSystemVoiceSupported()) speechSynthesis.cancel();
      setSpeaking(false);
    },

    // An utterance in flight cannot change volume, so a ducked system voice
    // keeps talking; the barge-in guard protects the user instead.
    duck() {},

    dispose() {
      generation++;
      stopWatchdog();
      if (isSystemVoiceSupported()) speechSynthesis.cancel();
    },
  };
}
