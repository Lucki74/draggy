import type { Attachment, ChatSession, Message, MessageVersion, SearchStep, TurnMetrics } from "../types";
import type { PlanItem } from "../plan/plan";
import { exportFilename } from "./export";

/** The whole conversation as a file: every message, thinking, each tool step with its inputs and
 * outputs, edits as before/after, the plan and the metrics. One view feeds both formats, so they
 * cannot disagree about what was in the chat. */

export interface TranscriptOptions {
  now?: Date;
}

export type ExportFormat = "md" | "html";

type Field = [string, string];

type Block =
  | { kind: "prose"; title: string; text: string }
  | { kind: "code"; title: string; text: string; lang: string }
  | { kind: "diff"; title: string; before: string; after: string }
  | { kind: "fields"; title: string; rows: Field[] }
  | { kind: "list"; title: string; items: string[] };

interface StepView {
  label: string;
  summary: string;
  blocks: Block[];
}

interface Body {
  text: string;
  thinking: string;
  notes: string[];
  attachments: string[];
  steps: StepView[];
  metrics: Field[];
}

interface MessageView extends Body {
  heading: string;
  role: Message["role"];
  alternates: { label: string; body: Body }[];
  tail: MessageView[];
}

interface TranscriptView {
  title: string;
  date: string;
  plan: PlanItem[];
  messages: MessageView[];
  condensed: boolean;
}

/** The shape both a message and one of its versions share, which is what gets shown. */
interface Shown {
  content: string;
  textContent?: string;
  thinkingContent?: string | null;
  steps?: SearchStep[];
  metrics?: TurnMetrics | null;
  attachments?: Attachment[];
  failed?: boolean;
  error?: string;
  stopped?: boolean;
  interrupted?: boolean;
  tail?: Message[];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function humanize(type: string): string {
  return type.replace(/_/g, " ");
}

function metricsRows(metrics: TurnMetrics): Field[] {
  const rows: Field[] = [
    ["Model", metrics.model],
    ["Prompt tokens", String(metrics.promptTokens)],
    ["Response tokens", String(metrics.responseTokens)],
    ["Tokens per second", metrics.tokensPerSecond.toFixed(1)],
    ["Time to first token", metrics.timeToFirstTokenMs === null ? "n/a" : `${metrics.timeToFirstTokenMs} ms`],
    ["Prompt time", `${metrics.promptMs} ms`],
    ["Response time", `${metrics.responseMs} ms`],
    ["Load time", `${metrics.loadMs} ms`],
    ["Total time", `${metrics.totalMs} ms`],
    ["Context window", String(metrics.contextWindow)],
    ["GPU", metrics.gpuPercent === null ? "n/a" : `${metrics.gpuPercent}%`],
  ];
  if (metrics.breakdown) rows.push(["Context breakdown", JSON.stringify(metrics.breakdown)]);
  return rows;
}

function stepView(step: SearchStep): StepView {
  const rows: Field[] = [];
  const blocks: Block[] = [];

  if (step.approval) {
    rows.push(["Tool", step.approval.tool]);
    if (step.approval.target) rows.push(["Target", step.approval.target]);
    rows.push(["Reason", step.approval.reason]);
    if (step.answer) rows.push(["Answer", step.answer]);
  }
  if (step.url) rows.push(["URL", step.url]);
  if (step.filepath) rows.push(["File", step.filepath]);
  if (step.filename) rows.push(["File name", step.filename]);
  if (step.language) rows.push(["Language", step.language]);
  if (step.model) rows.push(["Model", step.model]);
  if (step.retry) rows.push(["Retry", `${step.retry.attempt} of ${step.retry.of}`]);
  if (step.thoughtTime !== undefined) rows.push(["Thought time", `${step.thoughtTime} s`]);
  if (step.skill) rows.push(["Skill", step.skill]);
  if (step.checkpointId !== undefined) rows.push(["Checkpoint", String(step.checkpointId)]);
  if (step.change) rows.push(["Change", step.change]);
  if (step.image) {
    const image = step.image;
    rows.push(["Prompt", image.prompt], ["Status", image.status]);
    if (image.model) rows.push(["Model", image.model]);
    if (image.seed !== undefined) rows.push(["Seed", String(image.seed)]);
    if (image.width && image.height) rows.push(["Size", `${image.width} x ${image.height}`]);
    if (image.path) rows.push(["File", image.path]);
    if (image.error) rows.push(["Error", image.error]);
  }
  if (rows.length > 0) blocks.push({ kind: "fields", title: "Details", rows });

  if (step.cut) blocks.push({ kind: "prose", title: "Note", text: "Cut off mid-file, so nothing was saved." });
  if (step.question) {
    blocks.push({ kind: "prose", title: "Question", text: step.question.text });
    if (step.question.options.length > 0) {
      blocks.push({ kind: "list", title: "Options", items: step.question.options });
    }
  }
  if (step.reply === "cancelled") {
    blocks.push({ kind: "prose", title: "Reply", text: "Cancelled." });
  } else if (step.reply) {
    const reply: Field[] = [["Choices", step.reply.choices.join(", ") || "none"]];
    if (step.reply.text) reply.push(["Text", step.reply.text]);
    blocks.push({ kind: "fields", title: "Reply", rows: reply });
  }

  if (step.fileContent !== undefined) {
    blocks.push({ kind: "code", title: "File content", text: step.fileContent, lang: step.language ?? "" });
  }
  if (step.before !== undefined || step.after !== undefined) {
    blocks.push({ kind: "diff", title: "Edit", before: step.before ?? "", after: step.after ?? "" });
  }
  if (step.stdout) blocks.push({ kind: "code", title: "stdout", text: step.stdout, lang: "text" });
  if (step.stderr) blocks.push({ kind: "code", title: "stderr", text: step.stderr, lang: "text" });
  if (step.results && step.results.length > 0) {
    const items = step.results.map((result) => `${result.title} <${result.url}>: ${oneLine(result.snippet)}`);
    blocks.push({ kind: "list", title: "Results", items });
  }
  if (step.libraryHits && step.libraryHits.length > 0) {
    const items = step.libraryHits.map((hit) => `${hit.name} (${hit.score}) ${hit.path}`);
    blocks.push({ kind: "list", title: "Library", items });
  }
  if (step.app?.html) blocks.push({ kind: "code", title: "Widget HTML", text: step.app.html, lang: "html" });

  return { label: humanize(step.type), summary: oneLine(step.content ?? ""), blocks };
}

/** What the reader saw of one version, or of the message itself when it has none. */
function bodyOf(shown: Shown, attachments: Attachment[] | undefined): Body {
  const text = (shown.textContent ?? shown.content ?? "").trim();
  const thinking = (shown.thinkingContent ?? "").trim();
  const steps = (shown.steps ?? []).map(stepView);

  const notes: string[] = [];
  if (shown.failed) notes.push(`Failed: ${shown.error ?? "unknown error"}`);
  if (shown.stopped) notes.push("Stopped by the user");
  if (shown.interrupted) notes.push("The app closed while this reply was being written");

  return {
    text,
    thinking,
    notes,
    attachments: (attachments ?? []).map((file) => file.name),
    steps,
    metrics: shown.metrics ? metricsRows(shown.metrics) : [],
  };
}

function headingOf(message: Message, assistantName: string): string {
  if (message.role === "user") return "You";
  if (message.role === "system") return "System";
  return assistantName;
}

function messageView(message: Message, assistantName: string): MessageView {
  const versions: MessageVersion[] | undefined = message.versions;
  const index = message.currentVersionIndex ?? (versions ? versions.length - 1 : 0);
  const shown: Shown = versions && index < versions.length ? versions[index] : message;

  const body = bodyOf(shown, shown.attachments ?? message.attachments);
  if (message.role === "assistant" && !body.text && body.steps.length === 0 && body.notes.length === 0) {
    body.notes.push("No reply");
  }
  if (message.fold) {
    const state = message.fold.status === "running" ? "being folded" : "folded";
    body.notes.unshift(`Earlier conversation ${state} into notes (about ${message.fold.tokens} tokens)`);
  }

  const alternates = (versions ?? [])
    .map((version, position) => ({ version, position }))
    .filter(({ position }) => position !== index)
    .map(({ version, position }) => ({
      label: `Version ${position + 1}`,
      body: bodyOf(version, version.attachments ?? message.attachments),
    }));

  const tail = (shown.tail ?? message.tail ?? []).map((next) => messageView(next, assistantName));

  return {
    heading: headingOf(message, assistantName),
    role: message.role,
    ...body,
    alternates,
    tail,
  };
}

function transcriptView(session: ChatSession, options: TranscriptOptions): TranscriptView {
  const now = options.now ?? new Date();
  const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
  const assistantName =
    lastAssistant?.metrics?.model || session.generation?.model || "Assistant";

  return {
    title: oneLine(session.title || "Conversation"),
    date: now.toISOString().slice(0, 10),
    plan: session.plan ?? [],
    messages: session.messages.map((message) => messageView(message, assistantName)),
    condensed: Boolean(session.compaction),
  };
}

/** A fence longer than any backtick run in the text, so the text cannot close it early. */
function fence(text: string, lang: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = "`".repeat(Math.max(3, longest + 1));
  return `${marks}${lang}\n${text.replace(/\s+$/, "")}\n${marks}`;
}

function diffText(before: string, after: string): string {
  const removed = before ? before.split(/\r?\n/).map((line) => `- ${line}`) : [];
  const added = after ? after.split(/\r?\n/).map((line) => `+ ${line}`) : [];
  return [...removed, ...added].join("\n");
}

function mdHeading(level: number): string {
  return "#".repeat(Math.min(Math.max(level, 1), 6));
}

function writeBlockMarkdown(lines: string[], block: Block): void {
  if (block.kind === "prose") {
    lines.push(`**${block.title}**`, "", block.text, "");
  } else if (block.kind === "code") {
    lines.push(`**${block.title}**`, "", fence(block.text, block.lang), "");
  } else if (block.kind === "diff") {
    lines.push(`**${block.title}**`, "", fence(diffText(block.before, block.after), "diff"), "");
  } else if (block.kind === "fields") {
    lines.push(`**${block.title}**`, "");
    for (const [key, value] of block.rows) lines.push(`- **${key}:** ${oneLine(value)}`);
    lines.push("");
  } else {
    lines.push(`**${block.title}**`, "");
    for (const item of block.items) lines.push(`- ${oneLine(item)}`);
    lines.push("");
  }
}

function writeBodyMarkdown(lines: string[], body: Body, level: number): void {
  for (const note of body.notes) lines.push(`*${note}*`, "");
  if (body.attachments.length > 0) lines.push(`*Attached: ${body.attachments.join(", ")}*`, "");

  if (body.thinking) {
    lines.push(`${mdHeading(level)} Thinking`, "", body.thinking, "");
  }
  if (body.text) lines.push(body.text, "");

  if (body.steps.length > 0) {
    lines.push(`${mdHeading(level)} Steps`, "");
    body.steps.forEach((step, position) => {
      lines.push(`${mdHeading(level + 1)} ${position + 1}. ${step.label}`, "");
      if (step.summary) lines.push(step.summary, "");
      for (const block of step.blocks) writeBlockMarkdown(lines, block);
    });
  }

  if (body.metrics.length > 0) {
    lines.push(`${mdHeading(level)} Metrics`, "");
    for (const [key, value] of body.metrics) lines.push(`- ${key}: ${value}`);
    lines.push("");
  }

}

function writeMessageMarkdown(lines: string[], message: MessageView, level: number): void {
  lines.push(`${mdHeading(level)} ${message.heading}`, "");
  writeBodyMarkdown(lines, message, level + 1);
  for (const alternate of message.alternates) {
    lines.push(`${mdHeading(level + 1)} ${alternate.label}`, "");
    writeBodyMarkdown(lines, alternate.body, level + 2);
  }

  if (message.tail.length > 0) {
    lines.push(`${mdHeading(level + 1)} Conversation after this version`, "");
    for (const next of message.tail) writeMessageMarkdown(lines, next, level + 2);
  }
}

/** A whole conversation as Markdown, with thinking, tool steps and metrics under each reply. */
export function chatToMarkdown(session: ChatSession, options: TranscriptOptions = {}): string {
  const view = transcriptView(session, options);
  const lines: string[] = [`# ${view.title}`, "", `*Exported from Draggy on ${view.date}*`, ""];

  if (view.plan.length > 0) {
    lines.push("## Plan", "");
    for (const item of view.plan) {
      const mark = item.status === "done" ? "x" : " ";
      lines.push(`- [${mark}] ${oneLine(item.text)}`);
    }
    lines.push("");
  }

  if (view.messages.length === 0) {
    lines.push("This conversation is empty.", "");
  }
  for (const message of view.messages) writeMessageMarkdown(lines, message, 2);

  if (view.condensed) {
    lines.push(
      "---",
      "",
      "*Part of this conversation had been condensed into notes for the model.*",
      "",
    );
  }

  return lines.join("\n").replace(/\r\n/g, "\n") + "\n";
}

/** Escapes everything that could open markup, quotes included, so no content can break out of the page. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf7; --panel: #ffffff; --fg: #1d1d1f; --muted: #6b6b70; --rule: #e2e0da;
  --code-bg: #f3f2ee; --add-bg: #e3f5e8; --add-fg: #14532d; --del-bg: #fbe6e3; --del-fg: #7f1d1d;
  --user: #eef3fb; --accent: #b45309;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141415; --panel: #1c1c1e; --fg: #ececee; --muted: #9a9aa2; --rule: #2e2e33;
    --code-bg: #111112; --add-bg: #17301f; --add-fg: #a7e8b9; --del-bg: #3a1c1c; --del-fg: #f5b5b0;
    --user: #1a2231; --accent: #f59e0b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.6em; margin: 0 0 4px; }
h2 { font-size: 1.15em; margin: 0 0 8px; }
h3 { font-size: 1em; margin: 16px 0 8px; color: var(--muted); }
h4 { font-size: .9em; margin: 12px 0 4px; color: var(--muted); }
.meta, .note { color: var(--muted); font-size: .9em; }
.note { font-style: italic; margin: 4px 0; }
article.msg { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
article.role-user { background: var(--user); }
.prose { white-space: pre-wrap; overflow-wrap: anywhere; }
details { margin: 8px 0; border-top: 1px solid var(--rule); padding-top: 6px; }
details > summary { cursor: pointer; color: var(--muted); user-select: none; }
details > summary:hover { color: var(--fg); }
.step > summary .label { color: var(--accent); font-weight: 600; margin-inline-end: 8px; }
.step > summary .summary { overflow-wrap: anywhere; }
.inner { padding: 6px 0 2px 14px; border-inline-start: 2px solid var(--rule); }
.block { margin: 8px 0; }
pre { margin: 0; padding: 10px 12px; background: var(--code-bg); border-radius: 6px; font: 13px/1.45 ui-monospace, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 480px; overflow: auto; }
.diff pre { border-radius: 0; }
.diff .del { background: var(--del-bg); color: var(--del-fg); border-radius: 6px 6px 0 0; }
.diff .add { background: var(--add-bg); color: var(--add-fg); border-radius: 0 0 6px 6px; }
dl.fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0; }
dl.fields dt { color: var(--muted); }
dl.fields dd { margin: 0; overflow-wrap: anywhere; }
ul.items { margin: 4px 0; padding-inline-start: 20px; overflow-wrap: anywhere; }
ul.plan { list-style: none; padding: 0; margin: 0; }
ul.plan li::before { content: "\\2610  "; color: var(--muted); }
ul.plan li.done::before { content: "\\2611  "; color: var(--accent); }
ul.plan li.done { color: var(--muted); text-decoration: line-through; }
@media (max-width: 520px) { body { font-size: 14px; } main { padding: 16px 12px 48px; } }
`;

function htmlBlock(block: Block): string {
  if (block.kind === "prose") {
    return `<div class="block"><h4>${escapeHtml(block.title)}</h4><div class="prose">${escapeHtml(block.text)}</div></div>`;
  }
  if (block.kind === "code") {
    return `<div class="block"><h4>${escapeHtml(block.title)}</h4><pre>${escapeHtml(block.text)}</pre></div>`;
  }
  if (block.kind === "diff") {
    const removed = block.before ? block.before.split(/\r?\n/).map((line) => `- ${line}`).join("\n") : "";
    const added = block.after ? block.after.split(/\r?\n/).map((line) => `+ ${line}`).join("\n") : "";
    return `<div class="block"><h4>${escapeHtml(block.title)}</h4><div class="diff"><pre class="del">${escapeHtml(removed)}</pre><pre class="add">${escapeHtml(added)}</pre></div></div>`;
  }
  if (block.kind === "fields") {
    const rows = block.rows
      .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("");
    return `<div class="block"><h4>${escapeHtml(block.title)}</h4><dl class="fields">${rows}</dl></div>`;
  }
  const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<div class="block"><h4>${escapeHtml(block.title)}</h4><ul class="items">${items}</ul></div>`;
}

function htmlBody(body: Body): string {
  const parts: string[] = [];
  for (const note of body.notes) parts.push(`<p class="note">${escapeHtml(note)}</p>`);
  if (body.attachments.length > 0) {
    parts.push(`<p class="note">Attached: ${escapeHtml(body.attachments.join(", "))}</p>`);
  }
  if (body.thinking) {
    parts.push(`<details><summary>Thinking</summary><div class="inner prose">${escapeHtml(body.thinking)}</div></details>`);
  }
  if (body.text) parts.push(`<div class="prose">${escapeHtml(body.text)}</div>`);

  if (body.steps.length > 0) {
    const steps = body.steps.map((step, position) => {
      const summary = step.summary
        ? `<span class="summary">${escapeHtml(step.summary)}</span>`
        : "";
      const blocks = step.blocks.map(htmlBlock).join("");
      return `<details class="step"><summary><span class="label">${position + 1}. ${escapeHtml(step.label)}</span>${summary}</summary><div class="inner">${blocks}</div></details>`;
    });
    parts.push(`<h3>Steps (${body.steps.length})</h3>${steps.join("")}`);
  }

  if (body.metrics.length > 0) {
    const rows = body.metrics
      .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("");
    parts.push(`<details><summary>Metrics</summary><dl class="fields inner">${rows}</dl></details>`);
  }

  return parts.join("");
}

function htmlMessage(message: MessageView): string {
  const roleClass = `role-${message.role}`;
  let html = `<article class="msg ${roleClass}"><h2>${escapeHtml(message.heading)}</h2>${htmlBody(message)}`;
  for (const alternate of message.alternates) {
    html += `<details><summary>${escapeHtml(alternate.label)}</summary><div class="inner">${htmlBody(alternate.body)}</div></details>`;
  }
  if (message.tail.length > 0) {
    const next = message.tail.map(htmlMessage).join("");
    html += `<details><summary>Conversation after this version</summary><div class="inner">${next}</div></details>`;
  }
  return `${html}</article>`;
}

/** A whole conversation as one self-contained HTML page: no scripts, no remote files, light and dark. */
export function chatToHtml(session: ChatSession, options: TranscriptOptions = {}): string {
  const view = transcriptView(session, options);

  const plan =
    view.plan.length > 0
      ? `<section><h2>Plan</h2><ul class="plan">${view.plan
          .map((item) => `<li class="${item.status === "done" ? "done" : ""}">${escapeHtml(oneLine(item.text))}</li>`)
          .join("")}</ul></section>`
      : "";
  const messages =
    view.messages.length > 0
      ? view.messages.map(htmlMessage).join("")
      : `<p class="note">This conversation is empty.</p>`;
  const condensed = view.condensed
    ? `<hr><p class="note">Part of this conversation had been condensed into notes for the model.</p>`
    : "";

  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="generator" content="Draggy">`,
    `<title>${escapeHtml(view.title)}</title>`,
    `<style>${STYLE}</style></head><body><main>`,
    `<header><h1>${escapeHtml(view.title)}</h1><p class="meta">Exported from Draggy on ${escapeHtml(view.date)}</p></header>`,
    plan,
    messages,
    condensed,
    "</main></body></html>",
    "",
  ].join("\n");
}

/** The default file name for an export: the title and date, with the format's extension. */
export function transcriptFilename(session: ChatSession, format: ExportFormat, now = new Date()): string {
  return exportFilename(session, now).replace(/\.md$/, `.${format}`);
}
