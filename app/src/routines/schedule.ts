/** Schedules for routines: plain words or a raw five-field cron line, parsed to cron. */

export interface ScheduleMeaning {
  /** Translation key; the page fills the `{name}` slots from `vars`. */
  key: string;
  vars: Record<string, string>;
}

export type ParsedSchedule = { ok: true; cron: string; meaning: ScheduleMeaning } | { ok: false };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** What a schedule with no time of day runs at. */
const DEFAULT_TIME = { hour: 9, minute: 0 };

const pad = (n: number) => String(n).padStart(2, "0");

function parseTime(text: string): { hour: number; minute: number } | null {
  if (text === "noon") return { hour: 12, minute: 0 };
  if (text === "midnight") return { hour: 0, minute: 0 };
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function dayName(index: number, locale: string): string {
  // 2024-01-07 was a Sunday.
  const date = new Date(Date.UTC(2024, 0, 7 + index));
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
  } catch {
    return DAYS[index];
  }
}

/** One cron field as the set of values it allows, or null when it is not valid. */
function parseField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText, ...extra] = part.split("/");
    if (extra.length || !range) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else {
      const [a, b, ...more] = range.split("-");
      if (more.length || !/^\d+$/.test(a) || (b !== undefined && !/^\d+$/.test(b))) return null;
      from = Number(a);
      to = b === undefined ? (stepText === undefined ? from : max) : Number(b);
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values.size ? values : null;
}

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

function parseCron(cron: string): CronFields | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dow = parseField(fields[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;
  // Both 0 and 7 mean Sunday.
  if (dow.delete(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domAny: fields[2] === "*", dowAny: fields[4] === "*" };
}

export const isValidCron = (cron: string) => parseCron(cron) !== null;

function dayMatches(fields: CronFields, date: Date): boolean {
  if (!fields.month.has(date.getMonth() + 1)) return false;
  const inMonth = fields.dom.has(date.getDate());
  const inWeek = fields.dow.has(date.getDay());
  // Like cron: when both are restricted, either one is enough.
  if (!fields.domAny && !fields.dowAny) return inMonth || inWeek;
  return inMonth && inWeek;
}

export function cronMatches(cron: string, date: Date): boolean {
  const fields = parseCron(cron);
  if (!fields) return false;
  return dayMatches(fields, date) && fields.hour.has(date.getHours()) && fields.minute.has(date.getMinutes());
}

/** The first minute after `after` the cron fires, in local time, or null when none comes within a few years. */
export function nextRun(cron: string, after: number): number | null {
  const fields = parseCron(cron);
  if (!fields) return null;
  const date = new Date(after);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = after + 5 * 366 * 24 * 60 * 60 * 1000;
  while (date.getTime() <= limit) {
    if (!dayMatches(fields, date)) {
      date.setHours(24, 0, 0, 0);
    } else if (!fields.hour.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
    } else if (!fields.minute.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1);
    } else {
      return date.getTime();
    }
  }
  return null;
}

const at = (time: { hour: number; minute: number }) => `${pad(time.hour)}:${pad(time.minute)}`;

/** Reads `every day at 9`, `every weekday at 8:30`, `every monday`, `every 2 hours`, `hourly`, or a cron line. */
export function parseSchedule(input: string, locale = "en"): ParsedSchedule {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return { ok: false };

  if (/^[\d*/,\- ]+$/.test(text) && isValidCron(text)) {
    return { ok: true, cron: text, meaning: { key: "routineMeanCron", vars: { cron: text } } };
  }

  if (text === "hourly" || text === "every hour") {
    return { ok: true, cron: "0 * * * *", meaning: { key: "routineMeanHour", vars: {} } };
  }

  const every = /^every (\d{1,3}) (hours?|minutes?|mins?)$/.exec(text);
  if (every) {
    const n = Number(every[1]);
    if (every[2].startsWith("h")) {
      if (n < 1 || n > 23) return { ok: false };
      if (n === 1) return { ok: true, cron: "0 * * * *", meaning: { key: "routineMeanHour", vars: {} } };
      return { ok: true, cron: `0 */${n} * * *`, meaning: { key: "routineMeanHours", vars: { n: String(n) } } };
    }
    if (n < 1 || n > 59) return { ok: false };
    return { ok: true, cron: `*/${n} * * * *`, meaning: { key: "routineMeanMinutes", vars: { n: String(n) } } };
  }

  const match = /^(?:every ([a-z]+)|(daily|weekdays))(?: at (.+))?$/.exec(text);
  if (!match) return { ok: false };
  const what = match[2] === "daily" ? "day" : match[2] === "weekdays" ? "weekday" : match[1];
  let time = DEFAULT_TIME;
  if (match[3]) {
    const parsed = parseTime(match[3].trim());
    if (!parsed) return { ok: false };
    time = parsed;
  }
  const base = `${time.minute} ${time.hour} * *`;
  if (what === "day") {
    return { ok: true, cron: `${base} *`, meaning: { key: "routineMeanDay", vars: { time: at(time) } } };
  }
  if (what === "weekday") {
    return { ok: true, cron: `${base} 1-5`, meaning: { key: "routineMeanWeekdays", vars: { time: at(time) } } };
  }
  const index = DAYS.indexOf(what);
  if (index === -1) return { ok: false };
  return {
    ok: true,
    cron: `${base} ${index}`,
    meaning: { key: "routineMeanDow", vars: { day: dayName(index, locale), time: at(time) } },
  };
}
