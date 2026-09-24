import { synthesizeSound } from "./vocalSounds";
import type { VocalSound } from "./vocalSounds";
import type { EngineOptions, VoiceEngine } from "./voiceEngine";

/** The system voice: free, instant, every installed language, and the default. Chromium stalls it
 * after fifteen seconds and truncates long utterances. */

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
  /** Items held back behind a sound: the synthesiser has its own queue, but no way to pause it for
   * audio played elsewhere, so what follows a sound waits here until the sound has finished. */
  const waiting: ({ text: string } | { sound: VocalSound })[] = [];
  let sounding: AudioBufferSourceNode | null = null;

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

  const settleIfIdle = () => {
    if (queued === 0 && !sounding && waiting.length === 0) {
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
      if (queued === 0) drain();
      settleIfIdle();
    };
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  };

  const playNow = (sound: VocalSound) => {
    const context = options.context;
    if (!context) return;
    const samples = synthesizeSound(sound, { rate: context.sampleRate, register: options.register });
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const mine = generation;
    sounding = source;
    setSpeaking(true);
    source.onended = () => {
      if (mine !== generation) return;
      sounding = null;
      drain();
      settleIfIdle();
    };
    source.start();
  };

  /** Hands on what was waiting, up to the next sound that has to wait for speech to end. */
  const drain = () => {
    while (waiting.length > 0 && !sounding) {
      const next = waiting[0];
      if ("sound" in next) {
        if (queued > 0) return;
        waiting.shift();
        playNow(next.sound);
        return;
      }
      waiting.shift();
      speak(next.text);
    }
  };

  return {
    id: "system",

    enqueue(text) {
      const trimmed = text.trim();
      if (!trimmed || !isSystemVoiceSupported()) return;
      if (sounding || waiting.length > 0) {
        waiting.push({ text: trimmed });
        setSpeaking(true);
        return;
      }
      speak(trimmed);
    },

    playSound(sound) {
      if (!options.context) return;
      waiting.push({ sound });
      setSpeaking(true);
      drain();
    },

    cancel() {
      generation++;
      queued = 0;
      waiting.length = 0;
      if (sounding) {
        sounding.onended = null;
        try {
          sounding.stop();
        } catch {
          // Already over.
        }
        sounding = null;
      }
      stopWatchdog();
      if (isSystemVoiceSupported()) speechSynthesis.cancel();
      setSpeaking(false);
    },

    // An utterance in flight cannot change volume, so a ducked system voice
    // keeps talking; the barge-in guard protects the user instead.
    duck() {},

    dispose() {
      generation++;
      waiting.length = 0;
      sounding?.stop();
      sounding = null;
      stopWatchdog();
      if (isSystemVoiceSupported()) speechSynthesis.cancel();
    },
  };
}
