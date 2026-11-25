/** Markdown summary of a bench run: numbers only, never reply text. */
export const pct = (n, d) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}% (${n}/${d})`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(records, meta) {
  const lines = [`# Prompt bench: ${meta.name}`, "", `Tier ${meta.tier}${meta.variant ? `, variant ${meta.variant}` : ""}; ${meta.runs} runs per case, seed ${meta.seed}; ${meta.at}.`, ""];
  const groups = [...new Set(records.map((r) => r.group))];
  lines.push("| lang | group | pass | cases | mean prompt tok | mean output tok |", "|---|---|---|---|---|---|");
  for (const lang of meta.langs) {
    for (const group of groups) {
      const rs = records.filter((r) => r.lang === lang && r.group === group && !r.error);
      if (!rs.length) continue;
      lines.push(`| ${lang} | ${group} | ${pct(rs.filter((r) => r.pass).length, rs.length)} | ${new Set(rs.map((r) => r.id)).size} | ${Math.round(mean(rs.map((r) => r.promptTokens ?? 0)))} | ${Math.round(mean(rs.map((r) => r.outputTokens ?? 0)))} |`);
    }
  }
  const of = (fn, group) => records.filter((r) => !r.error && (!group || r.group === group)).filter(fn).length;
  const total = (group) => records.filter((r) => !r.error && (!group || r.group === group)).length;
  lines.push("", "| rate | value |", "|---|---|");
  lines.push(`| clock echo on greetings | ${pct(of((r) => r.clockEcho, "greetings"), total("greetings"))} |`);
  lines.push(`| clock mention on greetings | ${pct(of((r) => r.clockMention, "greetings"), total("greetings"))} |`);
  lines.push(`| wrong language | ${pct(of((r) => r.wrongLanguage), total())} |`);
  lines.push(`| false refusals | ${pct(of((r) => r.falseRefusal, "falseRefusals"), total("falseRefusals"))} |`);
  lines.push(`| lucki74 volunteered | ${pct(of((r) => r.creator), total())} |`);
  const ttft = records.map((r) => r.ttftMs).filter(Number.isFinite);
  if (ttft.length) lines.push(`| mean time to first token (ms) | ${Math.round(mean(ttft))} |`);
  const errors = records.filter((r) => r.error).length;
  if (errors) lines.push(`| request errors | ${errors} |`);
  return lines.join("\n") + "\n";
}

