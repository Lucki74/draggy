/** Written text to spoken text: numbers, money, percentages, units and symbols as words, per
 * language. Table-driven, so it is fast and testable; a small model told to "write numbers as
 * words" ignores it often enough that the voice cannot rely on that. */

type Lang = "en" | "fr" | "es" | "zh";

// ------------------------------------------------------------------------------------- numbers

const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_ONES[n % 10]}` : ""));
  else if (n > 0 || parts.length === 0) parts.push(EN_ONES[n]);
  return parts.join(" ");
}

function groups(n: number): number[] {
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n % 1000);
    n = Math.floor(n / 1000);
  }
  return out.length ? out : [0];
}

function enWords(n: number): string {
  if (n === 0) return "zero";
  const scales = ["", " thousand", " million", " billion", " trillion"];
  const parts = groups(n);
  return parts
    .map((group, i) => (group ? enBelowThousand(group) + scales[parts.length - 1 - i] : ""))
    .filter(Boolean)
    .join(" ");
}

const FR_ONES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const FR_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

function frBelowHundred(n: number): string {
  if (n < 20) return FR_ONES[n];
  if (n < 70) {
    const unit = n % 10;
    const ten = FR_TENS[Math.floor(n / 10)];
    return unit === 0 ? ten : unit === 1 ? `${ten} et un` : `${ten}-${FR_ONES[unit]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${FR_ONES[n - 60]}`;
  if (n === 80) return "quatre-vingts";
  return `quatre-vingt-${FR_ONES[n - 80]}`;
}

function frBelowThousand(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    parts.push(hundreds === 1 ? "cent" : `${FR_ONES[hundreds]} cent${rest === 0 && final ? "s" : ""}`);
  }
  if (rest > 0) {
    // "quatre-vingts" loses its s when anything follows it.
    parts.push(rest === 80 && !final ? "quatre-vingt" : frBelowHundred(rest));
  }
  return parts.join(" ") || FR_ONES[0];
}

function frWords(n: number): string {
  if (n === 0) return "zéro";
  const parts = groups(n);
  const out: string[] = [];
  parts.forEach((group, i) => {
    const scale = parts.length - 1 - i;
    if (!group) return;
    const last = scale === 0;
    if (scale === 1) out.push(group === 1 ? "mille" : `${frBelowThousand(group, false)} mille`);
    else if (scale === 2) out.push(`${group === 1 ? "un" : frBelowThousand(group, false)} million${group > 1 ? "s" : ""}`);
    else if (scale === 3) out.push(`${group === 1 ? "un" : frBelowThousand(group, false)} milliard${group > 1 ? "s" : ""}`);
    else out.push(frBelowThousand(group, last));
  });
  return out.join(" ");
}

const ES_ONES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const ES_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const ES_HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function esBelowThousand(n: number, apocope: boolean): string {
  if (n === 100) return "cien";
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ES_HUNDREDS[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n >= 30) parts.push(ES_TENS[Math.floor(n / 10)] + (n % 10 ? ` y ${ES_ONES[n % 10]}` : ""));
  else if (n > 0) parts.push(ES_ONES[n]);
  const text = parts.join(" ");
  // "veintiuno" and "uno" lose their ending before a noun: veintiún mil, un millón.
  return apocope ? text.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un") : text;
}

function esWords(n: number): string {
  if (n === 0) return "cero";
  const parts = groups(n);
  const out: string[] = [];
  parts.forEach((group, i) => {
    const scale = parts.length - 1 - i;
    if (!group) return;
    if (scale === 1) out.push(group === 1 ? "mil" : `${esBelowThousand(group, true)} mil`);
    else if (scale === 2) out.push(group === 1 ? "un millón" : `${esBelowThousand(group, true)} millones`);
    else out.push(esBelowThousand(group, false));
  });
  return out.join(" ");
}

const ZH_DIGITS = "零一二三四五六七八九";

function zhBelowTenThousand(n: number): string {
  const units = ["", "十", "百", "千"];
  const digits = String(n).padStart(4, "0").split("").map(Number);
  let out = "";
  let zero = false;
  digits.forEach((digit, i) => {
    const place = 3 - i;
    if (digit === 0) {
      if (out) zero = true;
      return;
    }
    if (zero) out += "零";
    zero = false;
    const word = digit === 2 && place >= 2 ? "两" : ZH_DIGITS[digit];
    out += (place === 1 && digit === 1 && !out ? "" : word) + units[place];
  });
  return out;
}

function zhWords(n: number): string {
  if (n === 0) return "零";
  const high = Math.floor(n / 10000);
  const low = n % 10000;
  if (high === 0) return zhBelowTenThousand(low);
  const front = high >= 10000 ? zhWords(high) : zhBelowTenThousand(high);
  const mid = low === 0 ? "" : low < 1000 ? `零${zhBelowTenThousand(low)}` : zhBelowTenThousand(low);
  return `${front}万${mid}`;
}

const WORDS: Record<Lang, (n: number) => string> = { en: enWords, fr: frWords, es: esWords, zh: zhWords };

const POINT: Record<Lang, string> = { en: " point ", fr: " virgule ", es: " coma ", zh: "点" };

/** One written number, integer or decimal, as words. Digits after the point are read one by one. */
export function numberToWords(value: string, lang: Lang): string {
  // Commas here are thousands separators; NUMBER only matches that form.
  const [whole, fraction] = value.replace(/,/g, "").split(".");
  const integer = Number(whole);
  if (!Number.isSafeInteger(integer) || integer > 999_999_999_999) return value;
  let out = WORDS[lang](integer);
  if (fraction) {
    const digits = fraction.split("").map((digit) => WORDS[lang](Number(digit)));
    out += POINT[lang] + digits.join(lang === "zh" ? "" : " ");
  }
  return out;
}

// -------------------------------------------------------------------------------- surrounding text

const CURRENCY: Record<string, Record<Lang, [string, string]>> = {
  "$": { en: ["dollar", "dollars"], fr: ["dollar", "dollars"], es: ["dólar", "dólares"], zh: ["美元", "美元"] },
  "€": { en: ["euro", "euros"], fr: ["euro", "euros"], es: ["euro", "euros"], zh: ["欧元", "欧元"] },
  "£": { en: ["pound", "pounds"], fr: ["livre", "livres"], es: ["libra", "libras"], zh: ["英镑", "英镑"] },
};

const PERCENT: Record<Lang, string> = { en: "percent", fr: "pour cent", es: "por ciento", zh: "百分之" };
const TO: Record<Lang, string> = { en: "to", fr: "à", es: "a", zh: "到" };
const AND: Record<Lang, string> = { en: "and", fr: "et", es: "y", zh: "和" };

const UNITS: Record<string, Record<Lang, [string, string]>> = {
  km: { en: ["kilometer", "kilometers"], fr: ["kilomètre", "kilomètres"], es: ["kilómetro", "kilómetros"], zh: ["公里", "公里"] },
  m: { en: ["meter", "meters"], fr: ["mètre", "mètres"], es: ["metro", "metros"], zh: ["米", "米"] },
  cm: { en: ["centimeter", "centimeters"], fr: ["centimètre", "centimètres"], es: ["centímetro", "centímetros"], zh: ["厘米", "厘米"] },
  mm: { en: ["millimeter", "millimeters"], fr: ["millimètre", "millimètres"], es: ["milímetro", "milímetros"], zh: ["毫米", "毫米"] },
  kg: { en: ["kilogram", "kilograms"], fr: ["kilogramme", "kilogrammes"], es: ["kilogramo", "kilogramos"], zh: ["公斤", "公斤"] },
  g: { en: ["gram", "grams"], fr: ["gramme", "grammes"], es: ["gramo", "gramos"], zh: ["克", "克"] },
  l: { en: ["liter", "liters"], fr: ["litre", "litres"], es: ["litro", "litros"], zh: ["升", "升"] },
  gb: { en: ["gigabyte", "gigabytes"], fr: ["gigaoctet", "gigaoctets"], es: ["gigabyte", "gigabytes"], zh: ["吉字节", "吉字节"] },
  mb: { en: ["megabyte", "megabytes"], fr: ["mégaoctet", "mégaoctets"], es: ["megabyte", "megabytes"], zh: ["兆字节", "兆字节"] },
  mph: { en: ["mile per hour", "miles per hour"], fr: ["mile à l'heure", "miles à l'heure"], es: ["milla por hora", "millas por hora"], zh: ["英里每小时", "英里每小时"] },
  "°c": { en: ["degree Celsius", "degrees Celsius"], fr: ["degré Celsius", "degrés Celsius"], es: ["grado Celsius", "grados Celsius"], zh: ["摄氏度", "摄氏度"] },
  "°f": { en: ["degree Fahrenheit", "degrees Fahrenheit"], fr: ["degré Fahrenheit", "degrés Fahrenheit"], es: ["grado Fahrenheit", "grados Fahrenheit"], zh: ["华氏度", "华氏度"] },
};

const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const UNIT_PATTERN = new RegExp(String.raw`(${NUMBER})\s?(km|mm|cm|kg|mph|gb|mb|°c|°f|m|g|l)(?![\p{L}\d])`, "giu");
const CURRENCY_PATTERN = new RegExp(String.raw`([$€£])\s?(${NUMBER})`, "g");
const PERCENT_PATTERN = new RegExp(String.raw`(${NUMBER})\s?%`, "g");
const RANGE_PATTERN = new RegExp(String.raw`(${NUMBER})\s?[-–]\s?(${NUMBER})(?![\d:])`, "g");
const NUMBER_PATTERN = new RegExp(String.raw`(?<![\p{L}\d.])${NUMBER}(?![\p{L}\d]|[.,]\d)`, "gu");

const TIME_PATTERN = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?:\s?([ap])\.?m\.?)?(?![\d:])/gi;

const LINK: Record<Lang, string> = { en: "a link", fr: "un lien", es: "un enlace", zh: "一个链接" };
const SNIPPET: Record<Lang, string> = { en: "a code snippet", fr: "un extrait de code", es: "un fragmento de código", zh: "一段代码" };

/** What to say in place of a link or a block of code, in `language`. */
export function linkWord(language: string): string {
  return LINK[toLang(language)];
}

export function snippetWord(language: string): string {
  return SNIPPET[toLang(language)];
}

function toLang(language: string): Lang {
  return language === "fr" || language === "es" || language === "zh" ? language : "en";
}

function sayTime(hour: string, minute: string, meridiem: string | undefined, lang: Lang): string {
  const h = Number(hour);
  const m = Number(minute);
  const say = (value: number) => numberToWords(String(value), lang);
  if (lang === "zh") return `${say(h)}点${m === 0 ? "" : m < 10 ? `零${say(m)}分` : `${say(m)}分`}`;
  if (lang === "fr") return `${say(h)} ${h > 1 ? "heures" : "heure"}${m === 0 ? "" : ` ${say(m)}`}`;
  if (lang === "es") return `${h === 1 ? "la una" : `las ${say(h)}`}${m === 0 ? "" : ` y ${say(m)}`}`;
  const spoken = m === 0 ? (meridiem ? "" : "o'clock") : m < 10 ? `oh ${say(m)}` : say(m);
  const suffix = meridiem ? `${meridiem.toLowerCase()} m` : "";
  return [say(h), spoken, suffix].filter(Boolean).join(" ");
}

/** Said as words, not letters. */
const SAID_AS_WORD = new Set(["NASA", "NATO", "OPEC", "UNICEF", "UNESCO", "FIFA", "OK", "COVID", "RADAR", "LASER", "SCUBA", "ASAP", "PIN", "WIFI", "JPEG", "GIF", "SQL", "UNIX", "LINUX", "SIM"]);
/** Acronyms that carry a vowel and are still spelled out. Anything else with a vowel is a shouted word. */
const SPELLED_WITH_VOWEL = new Set(["AI", "CPU", "GPU", "TPU", "CEO", "CFO", "CTO", "FBI", "CIA", "NBA", "NFL", "BBC", "CNN", "SUV", "DVD", "USD", "EUR", "GBP", "PNG", "SVG", "CSS", "NPU", "US", "USA", "UK", "UN", "EU", "UAE", "API", "URL", "PDF", "IO", "OS", "IOS", "AWS", "AMD", "IBM", "FAQ", "USB", "HIV", "DNA", "RNA", "EEUU", "ONU", "OMS", "UE", "UI", "UX", "IA", "ID", "IT", "TV", "AM", "PM", "EV", "AR", "VR"]);
const ACRONYM = /(?<![\p{L}\d'’])[A-Z]{2,4}(?![\p{L}\d'’])/gu;
const PATH = /(?:[A-Za-z]:)?(?:[\\/][\w.\-@~]+){2,}[\\/]?/g;

function spellOut(match: string): string {
  if (SAID_AS_WORD.has(match)) return match;
  if (/[AEIOUY]/.test(match) && !SPELLED_WITH_VOWEL.has(match)) return match;
  return match.split("").join(" ");
}

function isOne(value: string): boolean {
  return Number(value.replace(/,/g, "")) === 1;
}

/** The text a voice should read for `text` in `language`. Anything it does not recognise is left
 * alone. */
export function normalizeSpeech(text: string, language: string): string {
  const lang = toLang(language);
  const say = (value: string) => numberToWords(value, lang);

  return text
    .replace(TIME_PATTERN, (_, hour: string, minute: string, meridiem?: string) =>
      sayTime(hour, minute, meridiem, lang),
    )
    .replace(CURRENCY_PATTERN, (_, symbol: string, value: string) => {
      const [one, many] = CURRENCY[symbol][lang];
      return `${say(value)} ${isOne(value) ? one : many}`;
    })
    .replace(PERCENT_PATTERN, (_, value: string) =>
      lang === "zh" ? `${PERCENT.zh}${say(value)}` : `${say(value)} ${PERCENT[lang]}`,
    )
    .replace(UNIT_PATTERN, (_, value: string, unit: string) => {
      const [one, many] = UNITS[unit.toLowerCase()][lang];
      return `${say(value)}${lang === "zh" ? "" : " "}${isOne(value) ? one : many}`;
    })
    .replace(RANGE_PATTERN, (_, from: string, to: string) => `${say(from)} ${TO[lang]} ${say(to)}`)
    .replace(NUMBER_PATTERN, (value) => say(value))
    .replace(PATH, (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path)
    .replace(/\band\/or\b/gi, () => (lang === "en" ? "and or" : lang === "fr" ? "et ou" : lang === "es" ? "y o" : "和或"))
    .replace(ACRONYM, spellOut)
    .replace(/\s&\s/g, ` ${AND[lang]} `)
    .replace(/\s\+\s/g, lang === "en" ? " plus " : lang === "zh" ? " 加 " : lang === "fr" ? " plus " : " más ")
    .replace(/\s=\s/g, lang === "en" ? " equals " : lang === "zh" ? " 等于 " : lang === "fr" ? " égale " : " igual a ")
    .replace(/\s+/g, " ")
    .trim();
}
