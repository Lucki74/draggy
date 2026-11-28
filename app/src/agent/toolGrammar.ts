import type { ToolDefinition } from "../tools/registry";

/** Past these limits the reply is read as before: a long grammar costs the engine on every token. */
const MAX_TOOLS = 24;
const MAX_GRAMMAR_CHARS = 16000;
/** Tools with more keys than this get the loose form: any order, repeats allowed, required keys unchecked. */
const EXACT_KEYS = 4;
/** Whitespace between JSON tokens is capped so a model cannot pad until the reply runs out. */
const MAX_WHITESPACE = 8;

/** A GBNF grammar for a text-channel reply: optional reasoning, prose, then at most one `<tool>` call.
 * Nothing may follow the closing tag, so the model cannot write its own tool result. */
const BASE_RULES = String.raw`integer ::= "-"? ("0" | [1-9] [0-9]*)
number ::= integer ("." [0-9]+)? ([eE] [-+]? [0-9]+)?
boolean ::= "true" | "false"
string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]) )* "\""
jvalue ::= string | number | boolean | "null" | jobject | jarray
jobject ::= "{" ws ( string ws ":" ws jvalue ( ws "," ws string ws ":" ws jvalue )* )? ws "}"
jarray ::= "[" ws ( jvalue ( ws "," ws jvalue )* )? ws "]"
reasoning ::= ([^<] | "<" [^/<] | "</" [^t<] | "</t" [^h<] | "</th" [^i<] | "</thi" [^n<] | "</thin" [^k<] | "</think" [^>])* "</think>" ws
text ::= t0
t0 ::= [^<] t0 | "<" t1 | ""
t1 ::= "t" t2 | "<" t1 | [^t<] t0 | ""
t2 ::= "o" t3 | "<" t1 | [^o<] t0 | ""
t3 ::= "o" t4 | "<" t1 | [^o<] t0 | ""
t4 ::= "l" t5 | "<" t1 | [^l<] t0 | ""
t5 ::= "<" t1 | [^><] t0 | ""`;

/** Each value type the grammar can decode, by the schema's type name. */
const VALUE_RULES: Record<string, string> = {
  string: "string",
  integer: "integer",
  number: "number",
  boolean: "boolean",
  array: "jarray",
  object: "jobject",
};

/** The loose schema shape a parameter may carry beyond the typed fields. */
interface LooseParameter {
  type?: unknown;
  enum?: unknown;
  anyOf?: { type?: unknown }[];
  oneOf?: { type?: unknown }[];
}

/** A GBNF string literal. Backslashes and double quotes are escaped. */
function literal(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Whitespace of up to MAX_WHITESPACE characters, nested so each optional one needs the one before. */
function whitespaceRule(): string {
  const space = "[ \\t\\n]";
  let body = space;
  for (let depth = 1; depth < MAX_WHITESPACE; depth++) body = `${space} (${body})?`;
  return `ws ::= (${body})?`;
}

/** The value of one parameter: its enum values when it has any, else the types it may take. */
function valueRule(parameter: LooseParameter): string {
  if (Array.isArray(parameter.enum) && parameter.enum.length > 0) {
    return `(${parameter.enum.map((value) => literal(JSON.stringify(value))).join(" | ")})`;
  }
  const declared = Array.isArray(parameter.type)
    ? parameter.type
    : typeof parameter.type === "string"
      ? [parameter.type]
      : [...(parameter.anyOf ?? []), ...(parameter.oneOf ?? [])].map((branch) => branch.type);
  const rules = [...new Set(declared.map((type) => (type === "null" ? '"null"' : VALUE_RULES[String(type)] ?? "jvalue")))];
  if (rules.length === 0) return "jvalue";
  return rules.length === 1 ? rules[0] : `(${rules.join(" | ")})`;
}

/** Every ordering of the given indexes. */
function orderings(indexes: number[]): number[][] {
  if (indexes.length <= 1) return [indexes];
  return indexes.flatMap((first) =>
    orderings(indexes.filter((index) => index !== first)).map((rest) => [first, ...rest]),
  );
}

/** The rules for one tool's arguments. Up to EXACT_KEYS keys: every key set holding the required keys,
 * in every order, each key at most once. More keys: the loose form. */
function argumentRules(definition: ToolDefinition, index: number): string[] {
  const entries = Object.entries(definition.function.parameters.properties) as [string, LooseParameter][];
  const required = new Set(definition.function.parameters.required ?? []);
  const members = entries.map(
    ([key, parameter], position) => `member-${index}-${position} ::= ${literal(`"${key}"`)} ws ":" ws ${valueRule(parameter)}`,
  );
  const requiredPositions = entries.flatMap(([key], position) => (required.has(key) ? [position] : []));
  const optionalPositions = entries.flatMap(([key], position) => (required.has(key) ? [] : [position]));

  if (entries.length > EXACT_KEYS) {
    const alternatives = entries.map((_, position) => `member-${index}-${position}`).join(" | ");
    const body = `"{" ws ( member-${index} ( ws "," ws member-${index} )* )? ws "}"`;
    return [...members, `member-${index} ::= ${alternatives}`, `args-${index} ::= ${body}`];
  }

  const sequences: string[] = [];
  for (let mask = 0; mask < 1 << optionalPositions.length; mask++) {
    const chosen = optionalPositions.filter((_, bit) => mask & (1 << bit));
    for (const order of orderings([...requiredPositions, ...chosen])) {
      sequences.push(order.map((position) => `member-${index}-${position}`).join(' ws "," ws '));
    }
  }
  const alternatives = [...new Set(sequences.map((sequence) => (sequence === "" ? '""' : sequence)))];
  return [...members, `args-${index} ::= "{" ws ( ${alternatives.join(" | ")} ) ws "}"`];
}

/** The grammar of a text-channel reply for these tools. Empty when there are no tools, too many,
 * or the grammar would be too long: such replies are read as before. */
export function toolGrammar(definitions: ToolDefinition[]): string {
  if (definitions.length === 0 || definitions.length > MAX_TOOLS) return "";

  const calls = definitions.map((definition, index) => {
    const name = literal(`"${definition.function.name}"`);
    return `call-${index} ::= "{" ws "\\"name\\"" ws ":" ws ${name} ws "," ws "\\"args\\"" ws ":" ws args-${index} ws "}"`;
  });
  const arguments_ = definitions.flatMap((definition, index) => argumentRules(definition, index));
  const alternatives = definitions.map((_, index) => `call-${index}`).join(" | ");

  const grammar = [
    `root ::= reasoning? text tail`,
    `tail ::= call | ""`,
    `call ::= "<tool>" ws ( ${alternatives} ) ws "</tool>"`,
    whitespaceRule(),
    BASE_RULES,
    ...calls,
    ...arguments_,
  ].join("\n");
  return grammar.length > MAX_GRAMMAR_CHARS ? "" : grammar;
}
