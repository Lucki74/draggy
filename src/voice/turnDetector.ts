import {
  ENDPOINT_BASE_MS,
  ENDPOINT_FAST_MS,
  ENDPOINT_SLOW_MS,
} from "./constants";

/**
 * Deciding when someone has finished talking. Fixed silence is wrong both ways,
 * so this reads the last word instead: most of the benefit, and no download.
 */

export type Completeness = "complete" | "unfinished" | "unclear";

/**
 * Languages written without spaces between words, where the trailing-word rules
 * below cannot apply and punctuation has to carry the decision alone.
 */
const UNSPACED = new Set(["zh", "ja", "ko"]);

/** Sounds people make while still deciding what to say. */
const HESITATION: Record<string, string[]> = {
  en: ["um", "uh", "erm", "er", "hmm", "mmm", "like", "well", "i", "mean"],
  fr: ["euh", "heu", "hum", "bah", "ben", "enfin", "genre"],
  es: ["eh", "este", "esto", "pues", "bueno", "osea"],
  de: ["äh", "ähm", "hm", "also", "halt", "naja"],
  it: ["ehm", "eh", "cioè", "insomma", "tipo"],
  pt: ["hum", "eh", "tipo", "então", "assim"],
  nl: ["eh", "ehm", "nou", "dus", "zeg"],
  ru: ["эм", "ээ", "ну", "это", "типа"],
  ar: ["يعني", "اه", "امم"],
};

/**
 * Words that cannot end a sentence: conjunctions, prepositions, articles and
 * the like. If the transcript stops on one of these the speaker is mid-clause.
 */
const CONNECTOR: Record<string, string[]> = {
  en: [
    "and", "but", "or", "so", "because", "that", "which", "who", "if", "when",
    "while", "than", "then", "the", "a", "an", "of", "to", "for", "with", "in",
    "on", "at", "by", "from", "about", "into", "my", "your", "our", "their",
    "is", "are", "was", "were", "will", "would", "could", "should", "can",
    "it's", "i'm", "there's", "as", "like", "very", "really", "just",
  ],
  fr: [
    "et", "mais", "ou", "donc", "car", "parce", "que", "qui", "si", "quand",
    "le", "la", "les", "un", "une", "des", "du", "de", "à", "au", "aux", "pour",
    "avec", "dans", "sur", "sous", "par", "en", "mon", "ma", "mes", "ton",
    "est", "sont", "était", "c'est", "j'ai", "très", "assez",
  ],
  es: [
    "y", "pero", "o", "porque", "que", "quien", "si", "cuando", "el", "la",
    "los", "las", "un", "una", "de", "del", "a", "al", "para", "con", "en",
    "sobre", "por", "mi", "tu", "su", "es", "son", "era", "muy", "más",
  ],
  de: [
    "und", "aber", "oder", "weil", "dass", "der", "die", "das", "ein", "eine",
    "einen", "von", "zu", "für", "mit", "in", "auf", "an", "bei", "aus", "mein",
    "dein", "ist", "sind", "war", "sehr", "ganz", "noch", "auch",
  ],
  it: [
    "e", "ma", "o", "perché", "che", "chi", "se", "quando", "il", "lo", "la",
    "i", "gli", "le", "un", "una", "di", "del", "a", "al", "per", "con", "in",
    "su", "da", "mio", "tuo", "è", "sono", "era", "molto", "più",
  ],
  pt: [
    "e", "mas", "ou", "porque", "que", "quem", "se", "quando", "o", "a", "os",
    "as", "um", "uma", "de", "do", "da", "para", "com", "em", "no", "na",
    "por", "meu", "teu", "seu", "é", "são", "era", "muito", "mais",
  ],
  nl: [
    "en", "maar", "of", "omdat", "dat", "die", "als", "wanneer", "de", "het",
    "een", "van", "naar", "voor", "met", "in", "op", "aan", "bij", "uit",
    "mijn", "jouw", "is", "zijn", "was", "heel", "erg", "nog", "ook",
  ],
  ru: [
    "и", "но", "или", "потому", "что", "который", "если", "когда", "в", "на",
    "с", "к", "по", "за", "для", "из", "у", "о", "мой", "твой", "это", "очень",
    "ещё", "также", "чтобы",
  ],
  ar: [
    "و", "لكن", "أو", "لأن", "الذي", "إذا", "عندما", "في", "على", "من", "إلى",
    "مع", "عن", "هذا", "هذه", "جدا",
  ],
};

const TERMINAL = /[.!?。！？…]["'”’)\]]?$/;

/**
 * Nobody trails off into a question mark. These end a turn even after a word
 * that usually means more is coming: "Quelle heure est-il ?"
 */
const STRONG_TERMINAL = /[!?！？]["'”’)\]]?$/;
const MID_SENTENCE = /[,;:،、，:-]["'”’)\]]?$/;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.!?,;:"“”'’`()[\]{}…—–-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function listFor(table: Record<string, string[]>, language: string): string[] {
  return table[language] ?? table.en ?? [];
}

/**
 * Reads the tail of a transcript for whether the speaker sounds finished.
 * "unclear" is the honest answer for a bare fragment with no punctuation.
 */
export function judgeCompleteness(
  text: string,
  language: string,
): Completeness {
  const trimmed = text.trim();
  if (!trimmed) return "unclear";

  if (MID_SENTENCE.test(trimmed)) return "unfinished";

  const spoken = words(trimmed);

  if (UNSPACED.has(language)) {
    if (TERMINAL.test(trimmed)) return "complete";
    return trimmed.length >= 12 ? "unclear" : "unfinished";
  }

  const last = spoken[spoken.length - 1];
  if (!last) return "unclear";

  if (STRONG_TERMINAL.test(trimmed) && spoken.length >= 2) return "complete";

  // A trailing filler or connective outranks punctuation. Speech recognisers
  // happily write "so." when someone trailed off mid-thought.
  if (listFor(HESITATION, language).includes(last)) return "unfinished";
  if (listFor(CONNECTOR, language).includes(last)) return "unfinished";

  if (TERMINAL.test(trimmed)) {
    return spoken.length >= 2 ? "complete" : "unclear";
  }

  // No punctuation at all: a long utterance has probably ended and simply was
  // not punctuated, a two-word fragment probably has not.
  if (spoken.length >= 6) return "unclear";
  return spoken.length <= 2 ? "unfinished" : "unclear";
}

/**
 * How much silence to require before handing this turn to the model.
 */
export function endpointDelay(text: string, language: string): number {
  switch (judgeCompleteness(text, language)) {
    case "complete":
      return ENDPOINT_FAST_MS;
    case "unfinished":
      return ENDPOINT_SLOW_MS;
    default:
      return ENDPOINT_BASE_MS;
  }
}
