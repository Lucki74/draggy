import type { EngineOptions, VoiceEngine } from "./voiceEngine";

/**
 * The operating system's own voice, through the Web Speech API.
 *
 * It costs nothing, starts instantly and speaks every language the machine has
 * installed, which is why it is the default. It also has two long-standing
 * Chromium defects that have to be worked around: synthesis stalls after about
 * fifteen seconds of continuous speech, and utterances beyond a few hundred
 * characters are silently truncated.
 */

const VOICE_LANGUAGES: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  nl: "nl-NL",
  ru: "ru-RU",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  ar: "ar-SA",
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
        speechSynthesis.resume();
      }
    }, WATCHDOG_MS);
  };

  const stopWatchdog = () => {
    if (!watchdog) return;
    clearInterval(watchdog);
    watchdog = null;
  };

  return {
    id: "system",

    enqueue(text) {
      const trimmed = text.trim();
      if (!trimmed || !isSystemVoiceSupported()) return;

      const mine = generation;
      const utterance = new SpeechSynthesisUtterance(trimmed);
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
        if (queued === 0) {
          stopWatchdog();
          setSpeaking(false);
        }
      };

      utterance.onend = done;
      utterance.onerror = done;

      speechSynthesis.speak(utterance);
    },

    cancel() {
      generation++;
      queued = 0;
      stopWatchdog();
      if (isSystemVoiceSupported()) speechSynthesis.cancel();
      setSpeaking(false);
    },

    // There is no way to change the volume of an utterance already in flight,
    // so a ducked system voice simply keeps talking. The barge-in guard is what
    // protects the user here instead.
    duck() {},

    dispose() {
      generation++;
      stopWatchdog();
      if (isSystemVoiceSupported()) speechSynthesis.cancel();
    },
  };
}
