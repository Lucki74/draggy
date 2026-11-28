/** A small GBNF recognizer for tests: it accepts or refuses whole strings against the subset
 * toolGrammar emits (literals, classes, groups, alternation, `?`, `*`, `+`, rule references). */

type Node =
  | { kind: "lit"; text: string }
  | { kind: "cls"; negated: boolean; ranges: [number, number][] }
  | { kind: "ref"; name: string }
  | { kind: "seq"; items: Node[] }
  | { kind: "alt"; items: Node[] }
  | { kind: "opt" | "star" | "plus"; body: Node };

class Parser {
  private at = 0;
  private readonly text: string;
  constructor(text: string) {
    this.text = text;
  }

  done(): boolean {
    this.skipSpaces();
    return this.at >= this.text.length;
  }

  alternatives(): Node {
    const items = [this.sequence()];
    while (this.peek() === "|") {
      this.at++;
      items.push(this.sequence());
    }
    return items.length === 1 ? items[0] : { kind: "alt", items };
  }

  private sequence(): Node {
    const items: Node[] = [];
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === "" || c === "|" || c === ")") break;
      items.push(this.postfix());
    }
    return { kind: "seq", items };
  }

  private postfix(): Node {
    let node = this.atom();
    const c = this.peek();
    if (c === "?" || c === "*" || c === "+") {
      this.at++;
      node = { kind: c === "?" ? "opt" : c === "*" ? "star" : "plus", body: node };
    }
    return node;
  }

  private atom(): Node {
    const c = this.peek();
    if (c === '"') return { kind: "lit", text: this.literal() };
    if (c === "[") return this.characterClass();
    if (c === "(") {
      this.at++;
      const inner = this.alternatives();
      if (this.peek() !== ")") throw new Error(`expected ) at ${this.at}`);
      this.at++;
      return inner;
    }
    const name = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.at));
    if (!name) throw new Error(`unexpected ${JSON.stringify(c)} at ${this.at}`);
    this.at += name[0].length;
    return { kind: "ref", name: name[0] };
  }

  private literal(): string {
    this.at++;
    let out = "";
    while (this.text[this.at] !== '"') {
      if (this.at >= this.text.length) throw new Error("unterminated literal");
      out += this.character();
    }
    this.at++;
    return out;
  }

  private characterClass(): Node {
    this.at++;
    const negated = this.text[this.at] === "^";
    if (negated) this.at++;
    const ranges: [number, number][] = [];
    while (this.text[this.at] !== "]") {
      if (this.at >= this.text.length) throw new Error("unterminated class");
      const lo = this.character().charCodeAt(0);
      if (this.text[this.at] === "-" && this.text[this.at + 1] !== "]") {
        this.at++;
        ranges.push([lo, this.character().charCodeAt(0)]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    this.at++;
    return { kind: "cls", negated, ranges };
  }

  /** One character, with GBNF's escapes: \ \" \n \t \r and \xHH. */
  private character(): string {
    const c = this.text[this.at++];
    if (c !== "\\") return c;
    const e = this.text[this.at++];
    if (e === "x") {
      const hex = this.text.slice(this.at, this.at + 2);
      this.at += 2;
      return String.fromCharCode(parseInt(hex, 16));
    }
    const named: Record<string, string> = { n: "\n", t: "\t", r: "\r" };
    return named[e] ?? e;
  }

  private peek(): string {
    this.skipSpaces();
    return this.text[this.at] ?? "";
  }

  private skipSpaces() {
    while (this.text[this.at] === " ") this.at++;
  }
}

/** Parses `name ::= body` lines into a rule table. */
function parseGrammar(grammar: string): Map<string, Node> {
  const rules = new Map<string, Node>();
  for (const line of grammar.split("\n")) {
    if (line.trim() === "") continue;
    const split = line.indexOf(" ::= ");
    if (split < 0) throw new Error(`no rule in ${JSON.stringify(line)}`);
    const parser = new Parser(line.slice(split + 5));
    const body = parser.alternatives();
    if (!parser.done()) throw new Error(`trailing text in rule ${line.slice(0, split)}`);
    rules.set(line.slice(0, split), body);
  }
  return rules;
}

/** Whether the grammar, started at `root`, accepts the whole input. */
export function grammarAccepts(grammar: string, input: string, root = "root"): boolean {
  const rules = parseGrammar(grammar);
  const memo = new Map<string, Set<number>>();
  const active = new Set<string>();

  const matchesChar = (node: Extract<Node, { kind: "cls" }>, code: number) => {
    const inside = node.ranges.some(([lo, hi]) => code >= lo && code <= hi);
    return inside !== node.negated;
  };

  const closure = (body: Node, starts: Set<number>): Set<number> => {
    const result = new Set(starts);
    const frontier = [...starts];
    while (frontier.length > 0) {
      const at = frontier.pop() as number;
      for (const next of ends(body, at)) {
        if (!result.has(next)) {
          result.add(next);
          frontier.push(next);
        }
      }
    }
    return result;
  };

  const ends = (node: Node, at: number): Set<number> => {
    switch (node.kind) {
      case "lit":
        return new Set(input.startsWith(node.text, at) ? [at + node.text.length] : []);
      case "cls":
        return new Set(at < input.length && matchesChar(node, input.charCodeAt(at)) ? [at + 1] : []);
      case "ref": {
        const key = `${node.name}@${at}`;
        const cached = memo.get(key);
        if (cached) return cached;
        const body = rules.get(node.name);
        if (!body) throw new Error(`unknown rule ${node.name}`);
        if (active.has(key)) return new Set();
        active.add(key);
        const result = ends(body, at);
        active.delete(key);
        memo.set(key, result);
        return result;
      }
      case "seq": {
        let current = new Set([at]);
        for (const item of node.items) {
          const next = new Set<number>();
          for (const p of current) for (const q of ends(item, p)) next.add(q);
          current = next;
          if (current.size === 0) break;
        }
        return current;
      }
      case "alt": {
        const result = new Set<number>();
        for (const item of node.items) for (const q of ends(item, at)) result.add(q);
        return result;
      }
      case "opt":
        return new Set([at, ...ends(node.body, at)]);
      case "star":
        return closure(node.body, new Set([at]));
      case "plus":
        return closure(node.body, ends(node.body, at));
    }
  };

  return ends({ kind: "ref", name: root }, 0).has(input.length);
}
