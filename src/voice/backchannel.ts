/**
 * Backchannels — "mhm", "right", "yeah" — are not turns. An assistant that
 * restarts every time you agree with it feels broken, so these are dropped.
 */

const TOKENS: Record<string, string[]> = {
  en: [
    "mhm", "mm", "mmm", "hmm", "uh", "huh", "uhhuh", "ah", "oh", "yeah", "yep",
    "yup", "yes", "ok", "okay", "right", "sure", "true", "nice", "cool", "wow",
    "great", "exactly", "totally", "gotcha", "i", "see", "got", "it", "makes",
    "sense", "of", "course", "fair", "enough", "alright",
  ],
  fr: [
    "mhm", "hmm", "ah", "oh", "ouais", "oui", "ok", "daccord", "d'accord",
    "bien", "super", "exact", "voilà", "carrément", "je", "vois", "tout", "à",
    "fait", "bien", "sûr",
  ],
  es: [
    "mhm", "hmm", "ah", "oh", "sí", "si", "vale", "ok", "claro", "cierto",
    "genial", "exacto", "ya", "veo", "por", "supuesto", "bueno",
  ],
  de: [
    "mhm", "hmm", "ah", "oh", "ja", "jo", "ok", "okay", "genau", "klar",
    "stimmt", "gut", "super", "verstehe", "natürlich", "alles", "klar",
  ],
  it: [
    "mhm", "hmm", "ah", "oh", "sì", "si", "ok", "certo", "esatto", "giusto",
    "bene", "capito", "ho", "capito", "ovvio",
  ],
  pt: [
    "mhm", "hmm", "ah", "oh", "sim", "ok", "claro", "certo", "exato", "bom",
    "legal", "entendi", "com", "certeza",
  ],
  nl: [
    "mhm", "hmm", "ah", "oh", "ja", "jazeker", "ok", "oké", "precies", "klopt",
    "goed", "mooi", "snap", "het", "natuurlijk",
  ],
  ru: [
    "мгм", "ага", "угу", "ах", "ох", "да", "ок", "хорошо", "точно", "конечно",
    "ясно", "понятно", "верно",
  ],
  zh: ["嗯", "嗯嗯", "哦", "啊", "对", "对对", "好", "好的", "是", "是的", "明白", "懂了"],
  ja: [
    "うん", "うんうん", "ええ", "はい", "そう", "そうそう", "なるほど", "ああ",
    "へえ", "わかった", "オーケー",
  ],
  ko: ["음", "응", "어", "아", "네", "예", "그래", "맞아", "알겠어", "오케이"],
  ar: ["اها", "اه", "نعم", "ايوه", "طيب", "تمام", "اوكي", "صح", "اكيد", "فهمت"],
};

/** Backchannels are short by nature; anything longer carries real content. */
const MAX_WORDS = 3;
const MAX_CHARS = 24;

function listFor(language: string): Set<string> {
  return new Set(TOKENS[language] ?? TOKENS.en);
}

/**
 * True when the whole utterance is nothing but acknowledgement. Every token has
 * to match — "yeah but wait" contains "yeah" and is emphatically a real turn.
 */
export function isBackchannel(text: string, language: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_CHARS) return false;

  const cleaned = trimmed
    .toLowerCase()
    // A typographic apostrophe becomes a plain one and both stay put, so
    // "d'accord" is matched as the single word it is.
    .replace(/’/g, "'")
    .replace(/[.!?,;:"“”`()[\]{}…—–]/g, " ")
    .replace(/[。！？、，]/g, " ")
    .trim();

  if (!cleaned) return false;

  const known = listFor(language);
  const english = listFor("en");

  // Chinese, Japanese and Korean are not space-separated, so the whole string
  // is matched as one token.
  const parts = /\s/.test(cleaned) ? cleaned.split(/\s+/) : [cleaned];
  if (parts.length > MAX_WORDS) return false;

  return parts.every((part) => known.has(part) || english.has(part));
}
