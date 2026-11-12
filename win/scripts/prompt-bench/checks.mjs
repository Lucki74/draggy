/**
 * Checks for the prompt bench. Each one reads a reply, never a reference answer.
 *
 * A check spec in a corpus file is `{ "type": "maxWords", "n": 40 }`. `runCheck(spec, ctx)` returns
 * `{ pass, detail }`. The context is `{ reply, lang, now, toolCalls, requiredArgs }`:
 * `reply` is the raw model text, `toolCalls` the calls it made as `{ name, args }`.
 */

const WEEKDAYS = {
  en: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  fr: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  es: ["lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado", "domingo"],
  ru: ["понедельник", "вторник", "среда", "среду", "четверг", "пятница", "пятницу", "суббота", "субботу", "воскресенье"],
};
const MONTHS = {
  en: ["january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"],
  fr: ["janvier", "février", "fevrier", "mars", "avril", "juin", "juillet", "août", "aout", "septembre", "octobre", "novembre", "décembre", "decembre"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  ru: ["январь", "января", "февраль", "февраля", "март", "марта", "апрель", "апреля", "май", "мая", "июнь", "июня", "июль", "июля", "август", "августа", "сентябрь", "сентября", "октябрь", "октября", "ноябрь", "ноября", "декабрь", "декабря"],
};

/** Every language at once: a reply that talks about the clock does so in whatever language it likes. */
const ALL_WEEKDAYS = Object.values(WEEKDAYS).flat();
const ALL_MONTHS = Object.values(MONTHS).flat();

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordList = (words) => new RegExp(`(?<![\\p{L}])(?:${words.map(escape).join("|")})(?![\\p{L}])`, "iu");

const WEEKDAY_RE = wordList(ALL_WEEKDAYS);
const MONTH_RE = wordList(ALL_MONTHS);
const TIME_RE = /\b\d{1,2}\s?(?::|h|\.)\s?\d{2}\b|\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)\b|o'clock/i;
const DATE_RE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
const CLOCK_PHRASE_RE =
  /(?:current (?:time|date)|the time is|the date is|today is|it'?s \d|it is \d|il est \d|nous sommes le|on est (?:le|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|son las \d|es la una|hoy es|estamos a)/i;
const RU_CLOCK_RE = /сейчас\s+(?:\d|час|утро|вечер|ночь|день)|сегодня\s+\d|\d{1,2}:\d{2}|\d{1,2}\s?(?:часов|часа|утра|вечера)\b|\b\d{4}\s?год|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|(?:понедельник|вторник|четверг|пятниц[уа]|суббот[уа]|воскресень[ея])/i;

/** The share of a reply's letters that sit inside a time, date or weekday phrase. */
export function clockShare(reply) {
  const text = reply.trim();
  if (!text) return 0;
  let covered = 0;
  const patterns = [TIME_RE, DATE_RE, CLOCK_PHRASE_RE, RU_CLOCK_RE, WEEKDAY_RE, MONTH_RE];
  const marked = new Array(text.length).fill(false);
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const match of text.matchAll(global)) {
      for (let i = match.index; i < match.index + match[0].length; i++) marked[i] = true;
    }
  }
  for (const flag of marked) if (flag) covered++;
  return covered / text.length;
}

export const mentionsClock = (reply) =>
  TIME_RE.test(reply) || DATE_RE.test(reply) || CLOCK_PHRASE_RE.test(reply) || RU_CLOCK_RE.test(reply) || WEEKDAY_RE.test(reply) || MONTH_RE.test(reply);

/** A reply with its reasoning removed, which is what the user reads. */
export function visibleText(reply) {
  const closed = reply.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = closed.indexOf("<think>");
  return (open === -1 ? closed : closed.slice(0, open)).trim();
}

const wordsOf = (text) => text.trim().split(/\s+/).filter(Boolean);
const cyrCount = (text) => (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;

const STOPWORDS = {
  en: ["the", "and", "is", "are", "you", "to", "of", "it", "in", "that", "what", "for", "with", "can", "how", "this", "have", "hello", "hi", "thanks", "welcome", "help", "need", "your", "i", "an", "has", "was", "were", "be", "on", "at", "by", "from", "or", "not", "but", "do", "does", "will", "there", "year", "yes", "what's", "it's", "i'm", "my", "we", "they", "he", "she", "its", "if", "about", "which", "when", "all"],
  fr: ["le", "la", "les", "et", "est", "vous", "tu", "de", "des", "un", "une", "que", "pour", "avec", "je", "ce", "bonjour", "salut", "merci", "besoin", "votre", "pas", "comment", "qu'est", "peux", "aider"],
  es: ["el", "la", "los", "las", "y", "es", "usted", "tú", "de", "un", "una", "que", "para", "con", "yo", "hola", "gracias", "necesitas", "necesita", "puedo", "ayudar", "cómo", "no", "se", "por"],
  ru: ["и", "в", "не", "что", "это", "на", "я", "ты", "как", "для", "с", "по", "привет", "спасибо", "можно", "помочь", "вы", "мне", "тебе", "нужно", "или", "если"],
};

/** Words of a reply that belong to each Latin-script language. */
export function languageScores(text) {
  const tokens = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const scores = { en: 0, fr: 0, es: 0, ru: 0 };
  for (const token of tokens) {
    for (const lang of Object.keys(scores)) if (STOPWORDS[lang].includes(token)) scores[lang]++;
  }
  return scores;
}

/** The language a reply is in: ru by script, else the Latin or Cyrillic language with the most stopwords. */
export function detectReplyLanguage(text) {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return null;
  if (cyrCount(text) / letters >= 0.3) return "ru";
  const scores = languageScores(text);
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (best[0][1] === 0) return null;
  return best[0][0];
}

const REFUSAL = {
  en: [/\bI can'?t (?:help|assist|do|provide|comply)/i, /\bI(?:'m| am) (?:not able|unable|sorry)/i, /\bI won'?t\b/i, /\bI cannot\b/i, /\bI'?m sorry, but\b/i, /\bnot something I can\b/i],
  fr: [/je ne peux pas/i, /je ne suis pas en mesure/i, /désolé/i, /je refuse/i],
  es: [/no puedo (?:ayudar|ayudarte|proporcionar|hacer)/i, /lo siento/i, /no es algo con lo que pueda/i],
  ru: [/не могу (?:помочь|ответить|предоставить)/i, /извините/i, /к сожалению, я не/i],
};
export const isRefusal = (reply) => Object.values(REFUSAL).flat().some((re) => re.test(reply));

const SYMBOLS_RE = /[*#_`<>{}|\\~^=+@[\]]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Items in an answer to "give me N things": list lines, else comma or "and" separated parts. */
export function countItems(reply) {
  const lines = reply.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const listed = lines.filter((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line));
  if (listed.length) return listed.length;
  if (lines.length > 1 && lines.every((line) => wordsOf(line).length <= 4)) return lines.length;
  const body = reply.replace(/^[^:：]*[:：]/, "").replace(/[.。]$/, "");
  return body.split(/\s*(?:,|，|、|;|\band\b|\bet\b|\by\b|(?<![\p{L}])и(?![\p{L}]))\s*/iu).filter((part) => part.trim()).length;
}

const sentenceCount = (text) => (text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? []).filter((s) => s.trim()).length;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function daysUntil(now, month, day) {
  let target = new Date(now.getFullYear(), month - 1, day);
  if (startOfDay(target) < startOfDay(now)) target = new Date(now.getFullYear() + 1, month - 1, day);
  return Math.round((startOfDay(target) - startOfDay(now)) / 86400000);
}

const numbersIn = (text) => [...text.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+/g)].map((m) => Number(m[0]));

/** Hours a reader would accept for "now": 24-hour and 12-hour forms. */
const acceptedHours = (now) => {
  const hour = now.getHours();
  return new Set([hour, hour % 12 === 0 ? 12 : hour % 12]);
};

const CHECKS = {
  noClock: (spec, { reply }) => {
    const text = visibleText(reply);
    return { pass: !mentionsClock(text), detail: "reply mentions a time, date or weekday" };
  },
  clockEcho: (spec, { reply }) => {
    const text = visibleText(reply);
    return { pass: !(text.length > 0 && clockShare(text) >= 0.5), detail: "reply is mostly a time, date or weekday" };
  },
  hasClock: (spec, { reply, now }) => {
    const text = visibleText(reply);
    if (spec.kind === "date") {
      const day = now.getDate();
      const monthNumber = now.getMonth() + 1;
      const numbers = numbersIn(text);
      const hasDay = numbers.includes(day);
      const hasMonth = numbers.includes(monthNumber) || MONTH_RE.test(text) || /месяц/i.test(text);
      return { pass: hasDay && hasMonth, detail: `expected day ${day} and month ${monthNumber}` };
    }
    const hours = acceptedHours(now);
    const found = [...text.matchAll(/\b(\d{1,2})\s?(?::|h|\.)\s?(\d{2})\b|\b(\d{1,2})\s?(?:am|pm)\b|(\d{1,2})\s?(?:ч\.?|часов|часа|час)(?![а-яё])/gi)];
    const hit = found.some((m) => hours.has(Number(m[1] ?? m[3] ?? m[4])));
    return { pass: hit, detail: `expected hour ${[...hours].join(" or ")}` };
  },
  hasYear: (spec, { reply, now }) => ({
    pass: numbersIn(visibleText(reply)).includes(now.getFullYear()),
    detail: `expected ${now.getFullYear()}`,
  }),
  daysUntil: (spec, { reply, now }) => {
    const expected = daysUntil(now, spec.month, spec.day);
    return { pass: numbersIn(visibleText(reply)).includes(expected), detail: `expected ${expected} days` };
  },
  ageFrom: (spec, { reply, now }) => {
    const age = now.getFullYear() - spec.year;
    const accepted = [age, age - 1];
    return { pass: numbersIn(visibleText(reply)).some((n) => accepted.includes(n)), detail: `expected ${accepted.join(" or ")}` };
  },
  maxWords: (spec, { reply }) => {
    const text = visibleText(reply);
    const count = wordsOf(text).length;
    return { pass: count <= spec.n, detail: `${count} words, limit ${spec.n}` };
  },
  maxSentences: (spec, { reply }) => {
    const count = sentenceCount(visibleText(reply));
    return { pass: count <= spec.n, detail: `${count} sentences, limit ${spec.n}` };
  },
  sameLanguage: (spec, { reply, lang }) => {
    const expected = spec.lang ?? lang;
    const text = visibleText(reply);
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (letters === 0) return { pass: /\d/.test(text), detail: "empty reply" };
    const cyr = cyrCount(text) / letters;
    if (expected === "ru") return { pass: cyr >= 0.3, detail: `${Math.round(cyr * 100)}% Cyrillic letters` };
    if (cyr >= 0.3) return { pass: false, detail: "reply is Russian" };
    const scores = languageScores(text);
    const best = Math.max(...Object.values(scores));
    // One word of evidence is too thin to call a short reply wrong.
    if (best === 0) return { pass: wordsOf(text).length <= 12, detail: "no language evidence" };
    return { pass: scores[expected] >= best, detail: `scores ${JSON.stringify(scores)}` };
  },
  contains: (spec, { reply }) => {
    const text = visibleText(reply).toLowerCase();
    const options = Array.isArray(spec.token) ? spec.token : [spec.token];
    return { pass: options.some((token) => text.includes(String(token).toLowerCase())), detail: `expected ${options.join(" or ")}` };
  },
  notContains: (spec, { reply }) => {
    const text = visibleText(reply).toLowerCase();
    const options = Array.isArray(spec.token) ? spec.token : [spec.token];
    return { pass: !options.some((token) => text.includes(String(token).toLowerCase())), detail: `found ${options.join(" or ")}` };
  },
  count: (spec, { reply }) => {
    const found = countItems(visibleText(reply));
    return { pass: found === spec.n, detail: `${found} items, expected ${spec.n}` };
  },
  noRefusal: (spec, { reply }) => ({ pass: !isRefusal(visibleText(reply)), detail: "reply refuses" }),
  isRefusal: (spec, { reply }) => ({ pass: isRefusal(visibleText(reply)), detail: "reply does not refuse" }),
  noThinkLeak: (spec, { reply }) => {
    const opens = (reply.match(/<think>/gi) ?? []).length;
    const closes = (reply.match(/<\/think>/gi) ?? []).length;
    if (opens > closes) return { pass: false, detail: "unclosed <think>" };
    const after = opens ? reply.slice(reply.lastIndexOf("</think>") + 8) : reply;
    return { pass: after.trim().length > 0, detail: "no answer outside the think block" };
  },
  toolCall: (spec, { toolCalls }) => {
    const names = toolCalls.map((call) => call.name);
    const options = Array.isArray(spec.name) ? spec.name : [spec.name];
    return { pass: names.some((name) => options.includes(name)), detail: `called ${names.join(", ") || "nothing"}` };
  },
  validArgs: (spec, { toolCalls, requiredArgs }) => {
    if (toolCalls.length === 0) return { pass: false, detail: "no call" };
    const bad = toolCalls.find((call) => (requiredArgs[call.name] ?? []).some((key) => call.args?.[key] === undefined || call.args?.[key] === ""));
    return { pass: !bad, detail: bad ? `${bad.name} lacks a required argument` : "" };
  },
  argContains: (spec, { toolCalls }) => {
    const call = toolCalls.find((entry) => entry.name === spec.name) ?? toolCalls[0];
    const value = JSON.stringify(call?.args ?? {}).toLowerCase();
    return { pass: value.includes(String(spec.token).toLowerCase()), detail: `args ${value}` };
  },
  noToolCall: (spec, { toolCalls }) => ({ pass: toolCalls.length === 0, detail: `called ${toolCalls.map((c) => c.name).join(", ")}` }),
  noSymbols: (spec, { reply }) => ({ pass: !SYMBOLS_RE.test(visibleText(reply)), detail: "reply has symbols" }),
  numbersAsWords: (spec, { reply }) => ({ pass: !/\d/.test(visibleText(reply)), detail: "reply has digits" }),
  noCreatorMention: (spec, { reply }) => ({ pass: !/lucki74/i.test(visibleText(reply)), detail: "reply names the creator" }),
  nonEmpty: (spec, { reply }) => ({ pass: visibleText(reply).length > 0, detail: "empty reply" }),
  answersLast: (spec, { reply }) => {
    const text = visibleText(reply).toLowerCase();
    const earlier = (spec.earlier ?? []).filter((word) => text.includes(word.toLowerCase()));
    const last = spec.last ?? [];
    const lastHit = last.length === 0 || last.some((word) => text.includes(word.toLowerCase()));
    return { pass: earlier.length === 0 && lastHit, detail: `earlier-topic words: ${earlier.join(", ") || "none"}; last-topic hit: ${lastHit}` };
  },
};

export function runCheck(spec, ctx) {
  const check = CHECKS[spec.type];
  if (!check) throw new Error(`Unknown check ${spec.type}`);
  const { pass, detail } = check(spec, ctx);
  return { type: spec.type, pass, ...(pass ? {} : { detail }) };
}

export const CHECK_TYPES = Object.keys(CHECKS);
