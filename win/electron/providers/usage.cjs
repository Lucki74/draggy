/** What a provider reports about tokens, in one shape. Vendors disagree on whether cache hits and reasoning
 * are inside the headline counts or beside them, so each builder here settles that once and returns disjoint
 * buckets the cost engine can price one by one. `promptTokens` and `outputTokens` stay as sums for the readers
 * that never needed the split. */

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** `source` is "reported" when the vendor split the counts itself, "derived" when only totals came back. */
function tokenUsage({ input = 0, cacheRead = 0, cacheWrite = 0, output = 0, reasoning = 0, source = "reported", costUsd } = {}) {
  const tokens = { input: count(input), cacheRead: count(cacheRead), cacheWrite: count(cacheWrite), output: count(output), reasoning: count(reasoning), source };
  if (Number.isFinite(costUsd) && costUsd >= 0) tokens.costUsd = costUsd;
  return tokens;
}

/** The legacy pair plus the split. */
function usageOf(tokens) {
  return {
    promptTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
    outputTokens: tokens.output + tokens.reasoning,
    tokens,
  };
}

/** Anthropic: the three input buckets are disjoint; thinking is billed as output and already inside it. */
function fromAnthropic(u = {}) {
  return usageOf(
    tokenUsage({ input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }),
  );
}

/** OpenAI-style: cached and reasoning counts are subsets of the headline counts. OpenRouter adds
 * `cache_write_tokens` and the amount it charged in `cost`. */
function fromOpenAI(u = {}) {
  const details = u.prompt_tokens_details || {};
  const cacheRead = count(details.cached_tokens ?? u.prompt_cache_hit_tokens);
  const cacheWrite = count(details.cache_write_tokens);
  const reasoning = count(u.completion_tokens_details?.reasoning_tokens);
  const prompt = count(u.prompt_tokens);
  const completion = count(u.completion_tokens);
  const split = u.prompt_tokens_details !== undefined || u.completion_tokens_details !== undefined || u.prompt_cache_hit_tokens !== undefined;
  return usageOf(
    tokenUsage({
      input: Math.max(0, prompt - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite,
      output: Math.max(0, completion - reasoning),
      reasoning,
      source: split ? "reported" : "derived",
      costUsd: typeof u.cost === "number" ? u.cost : undefined,
    }),
  );
}

/** Gemini: the prompt count includes cached content; thinking tokens come on top of the candidates. */
function fromGemini(m = {}) {
  const cached = count(m.cachedContentTokenCount);
  return usageOf(
    tokenUsage({
      input: Math.max(0, count(m.promptTokenCount) - cached),
      cacheRead: cached,
      output: m.candidatesTokenCount,
      reasoning: m.thoughtsTokenCount,
    }),
  );
}

/** Codex's token usage: cached input and reasoning output are subsets of the totals, as in OpenAI's. */
function fromCodex(last = {}) {
  const cacheRead = count(last.cachedInputTokens);
  const reasoning = count(last.reasoningOutputTokens);
  return usageOf(
    tokenUsage({
      input: Math.max(0, count(last.inputTokens) - cacheRead),
      cacheRead,
      output: Math.max(0, count(last.outputTokens) - reasoning),
      reasoning,
    }),
  );
}

/** Engines that report one prompt count and one output count (Ollama, agy). */
function fromTotals(prompt, output) {
  return usageOf(tokenUsage({ input: prompt, output, source: "derived" }));
}

/** Adds one pass to a running total; a missing side counts as nothing. */
function addTokens(a, b) {
  if (!a) return b;
  if (!b) return a;
  const costUsd = a.costUsd !== undefined || b.costUsd !== undefined ? (a.costUsd ?? 0) + (b.costUsd ?? 0) : undefined;
  return tokenUsage({
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    source: a.source === "reported" && b.source === "reported" ? "reported" : "derived",
    costUsd,
  });
}

module.exports = { tokenUsage, usageOf, fromAnthropic, fromOpenAI, fromGemini, fromCodex, fromTotals, addTokens };
