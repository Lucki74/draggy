/** Written text to spoken text: numbers, money, percentages, units and symbols as words, per
 * language. Table-driven, so it is fast and testable; a small model told to "write numbers as
 * words" ignores it often enough that the voice cannot rely on that. */

type Lang = "en" | "fr" | "es" | "ru";

/** One word per grammatical number: singular, the form after 2-4 (Russian), and the plural. English,
 * French and Spanish only use the first two. */
type Forms = [string, string, string];

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

const RU_ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_ONES_FEMININE = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const RU_TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const RU_HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
/** Above the thousands: the word for each power of a thousand, in the three forms Russian needs. */
const RU_SCALES: Forms[] = [
  ["", "", ""],
  ["тысяча", "тысячи", "тысяч"],
  ["миллион", "миллиона", "миллионов"],
  ["миллиард", "миллиарда", "миллиардов"],
  ["триллион", "триллиона", "триллионов"],
];

/** Russian agreement: 1 приз, 2-4 приза, 5+ призов (11-14 are always the last form). */
function plural(n: number, [one, few, many]: Forms): string {
  const tens = n % 100;
  const units = n % 10;
  if (units === 1 && tens !== 11) return one;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

function ruBelowThousand(n: number, feminine: boolean): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(RU_HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) {
    parts.push(RU_TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens >= 2) parts.push(RU_TENS[tens]);
    if (units) parts.push(feminine ? RU_ONES_FEMININE[units] : RU_ONES[units]);
  }
  return parts.join(" ");
}

function ruWords(n: number, feminine = false): string {
  if (n === 0) return "ноль";
  const parts = groups(n);
  const out: string[] = [];
  parts.forEach((group, i) => {
    const scale = parts.length - 1 - i;
    if (!group) return;
    if (scale === 0) {
      out.push(ruBelowThousand(group, feminine));
      return;
    }
    // Thousands are feminine (одна тысяча, две тысячи); the larger scales are masculine.
    out.push(`${ruBelowThousand(group, scale === 1)} ${plural(group, RU_SCALES[scale])}`);
  });
  return out.join(" ");
}

const WORDS: Record<Lang, (n: number) => string> = { en: enWords, fr: frWords, es: esWords, ru: (n) => ruWords(n) };

const POINT: Record<Lang, string> = { en: " point ", fr: " virgule ", es: " coma ", ru: " запятая " };

/** One written number, integer or decimal, as words. Digits after the point are read one by one. */
export function numberToWords(value: string, lang: Lang): string {
  // Commas here are thousands separators; NUMBER only matches that form.
  const [whole, fraction] = value.replace(/,/g, "").split(".");
  const integer = Number(whole);
  if (!Number.isSafeInteger(integer) || integer > 999_999_999_999) return value;
  let out = WORDS[lang](integer);
  if (fraction) {
    const digits = fraction.split("").map((digit) => WORDS[lang](Number(digit)));
    out += POINT[lang] + digits.join(" ");
  }
  return out;
}

// -------------------------------------------------------------------------------- surrounding text

/** The noun for `amount` in `lang`: Russian takes its own agreement, the others singular or plural. */
function pick(lang: Lang, forms: Forms, amount: number): string {
  if (lang === "ru") return plural(Math.floor(amount), forms);
  return amount === 1 ? forms[0] : forms[1];
}

const CURRENCY: Record<string, Record<Lang, Forms>> = {
  "$": { en: ["dollar", "dollars", "dollars"], fr: ["dollar", "dollars", "dollars"], es: ["dólar", "dólares", "dólares"], ru: ["доллар", "доллара", "долларов"] },
  "€": { en: ["euro", "euros", "euros"], fr: ["euro", "euros", "euros"], es: ["euro", "euros", "euros"], ru: ["евро", "евро", "евро"] },
  "£": { en: ["pound", "pounds", "pounds"], fr: ["livre", "livres", "livres"], es: ["libra", "libras", "libras"], ru: ["фунт", "фунта", "фунтов"] },
};

const PERCENT: Record<Lang, Forms> = {
  en: ["percent", "percent", "percent"],
  fr: ["pour cent", "pour cent", "pour cent"],
  es: ["por ciento", "por ciento", "por ciento"],
  ru: ["процент", "процента", "процентов"],
};
const TO: Record<Lang, string> = { en: "to", fr: "à", es: "a", ru: "до" };
const AND: Record<Lang, string> = { en: "and", fr: "et", es: "y", ru: "и" };

const UNITS: Record<string, Record<Lang, Forms>> = {
  km: { en: ["kilometer", "kilometers", "kilometers"], fr: ["kilomètre", "kilomètres", "kilomètres"], es: ["kilómetro", "kilómetros", "kilómetros"], ru: ["километр", "километра", "километров"] },
  m: { en: ["meter", "meters", "meters"], fr: ["mètre", "mètres", "mètres"], es: ["metro", "metros", "metros"], ru: ["метр", "метра", "метров"] },
  cm: { en: ["centimeter", "centimeters", "centimeters"], fr: ["centimètre", "centimètres", "centimètres"], es: ["centímetro", "centímetros", "centímetros"], ru: ["сантиметр", "сантиметра", "сантиметров"] },
  mm: { en: ["millimeter", "millimeters", "millimeters"], fr: ["millimètre", "millimètres", "millimètres"], es: ["milímetro", "milímetros", "milímetros"], ru: ["миллиметр", "миллиметра", "миллиметров"] },
  kg: { en: ["kilogram", "kilograms", "kilograms"], fr: ["kilogramme", "kilogrammes", "kilogrammes"], es: ["kilogramo", "kilogramos", "kilogramos"], ru: ["килограмм", "килограмма", "килограммов"] },
  g: { en: ["gram", "grams", "grams"], fr: ["gramme", "grammes", "grammes"], es: ["gramo", "gramos", "gramos"], ru: ["грамм", "грамма", "граммов"] },
  l: { en: ["liter", "liters", "liters"], fr: ["litre", "litres", "litres"], es: ["litro", "litros", "litros"], ru: ["литр", "литра", "литров"] },
  gb: { en: ["gigabyte", "gigabytes", "gigabytes"], fr: ["gigaoctet", "gigaoctets", "gigaoctets"], es: ["gigabyte", "gigabytes", "gigabytes"], ru: ["гигабайт", "гигабайта", "гигабайт"] },
  mb: { en: ["megabyte", "megabytes", "megabytes"], fr: ["mégaoctet", "mégaoctets", "mégaoctets"], es: ["megabyte", "megabytes", "megabytes"], ru: ["мегабайт", "мегабайта", "мегабайт"] },
  mph: { en: ["mile per hour", "miles per hour", "miles per hour"], fr: ["mile à l'heure", "miles à l'heure", "miles à l'heure"], es: ["milla por hora", "millas por hora", "millas por hora"], ru: ["миля в час", "мили в час", "миль в час"] },
  "°c": { en: ["degree Celsius", "degrees Celsius", "degrees Celsius"], fr: ["degré Celsius", "degrés Celsius", "degrés Celsius"], es: ["grado Celsius", "grados Celsius", "grados Celsius"], ru: ["градус Цельсия", "градуса Цельсия", "градусов Цельсия"] },
  "°f": { en: ["degree Fahrenheit", "degrees Fahrenheit", "degrees Fahrenheit"], fr: ["degré Fahrenheit", "degrés Fahrenheit", "degrés Fahrenheit"], es: ["grado Fahrenheit", "grados Fahrenheit", "grados Fahrenheit"], ru: ["градус Фаренгейта", "градуса Фаренгейта", "градусов Фаренгейта"] },
};

const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const UNIT_PATTERN = new RegExp(String.raw`(${NUMBER})\s?(km|mm|cm|kg|mph|gb|mb|°c|°f|m|g|l)(?![\p{L}\d])`, "giu");
const CURRENCY_PATTERN = new RegExp(String.raw`([$€£])\s?(${NUMBER})`, "g");
const PERCENT_PATTERN = new RegExp(String.raw`(${NUMBER})\s?%`, "g");
const RANGE_PATTERN = new RegExp(String.raw`(${NUMBER})\s?[-–]\s?(${NUMBER})(?![\d:])`, "g");
const NUMBER_PATTERN = new RegExp(String.raw`(?<![\p{L}\d.])${NUMBER}(?![\p{L}\d]|[.,]\d)`, "gu");

const TIME_PATTERN = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?:\s?([ap])\.?m\.?)?(?![\d:])/gi;

const LINK: Record<Lang, string> = { en: "a link", fr: "un lien", es: "un enlace", ru: "ссылку" };
const SNIPPET: Record<Lang, string> = { en: "a code snippet", fr: "un extrait de code", es: "un fragmento de código", ru: "фрагмент кода" };

/** What to say in place of a link or a block of code, in `language`. */
export function linkWord(language: string): string {
  return LINK[toLang(language)];
}

export function snippetWord(language: string): string {
  return SNIPPET[toLang(language)];
}

function toLang(language: string): Lang {
  return language === "fr" || language === "es" || language === "ru" ? language : "en";
}

function sayTime(hour: string, minute: string, meridiem: string | undefined, lang: Lang): string {
  const h = Number(hour);
  const m = Number(minute);
  const say = (value: number) => numberToWords(String(value), lang);
  if (lang === "ru") {
    const hours = `${say(h)} ${plural(h, ["час", "часа", "часов"])}`;
    return m === 0 ? hours : `${hours} ${ruWords(m, true)} ${plural(m, ["минута", "минуты", "минут"])}`;
  }
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

/** The text a voice should read for `text` in `language`. Anything it does not recognise is left
 * alone. */
export function normalizeSpeech(text: string, language: string): string {
  const lang = toLang(language);
  const say = (value: string) => numberToWords(value, lang);
  const amountOf = (value: string) => Number(value.replace(/,/g, ""));

  return text
    .replace(TIME_PATTERN, (_, hour: string, minute: string, meridiem?: string) =>
      sayTime(hour, minute, meridiem, lang),
    )
    .replace(CURRENCY_PATTERN, (_, symbol: string, value: string) => {
      const noun = pick(lang, CURRENCY[symbol][lang], amountOf(value));
      return `${say(value)} ${noun}`;
    })
    .replace(PERCENT_PATTERN, (_, value: string) => `${say(value)} ${pick(lang, PERCENT[lang], amountOf(value))}`)
    .replace(UNIT_PATTERN, (_, value: string, unit: string) => {
      const noun = pick(lang, UNITS[unit.toLowerCase()][lang], amountOf(value));
      return `${say(value)} ${noun}`;
    })
    .replace(RANGE_PATTERN, (_, from: string, to: string) => `${say(from)} ${TO[lang]} ${say(to)}`)
    .replace(NUMBER_PATTERN, (value) => say(value))
    .replace(PATH, (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path)
    .replace(/\band\/or\b/gi, () => (lang === "en" ? "and or" : lang === "fr" ? "et ou" : lang === "es" ? "y o" : "и или"))
    .replace(ACRONYM, spellOut)
    .replace(/\s&\s/g, ` ${AND[lang]} `)
    .replace(/\s\+\s/g, lang === "en" ? " plus " : lang === "fr" ? " plus " : lang === "ru" ? " плюс " : " más ")
    .replace(/\s=\s/g, lang === "en" ? " equals " : lang === "fr" ? " égale " : lang === "ru" ? " равно " : " igual a ")
    .replace(/\s+/g, " ")
    .trim();
}
