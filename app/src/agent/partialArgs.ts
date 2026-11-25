// Scans tool-call arguments that are still arriving. Output is display state only: it is never stored, sent
// to the model or run. core/crates/agent/src/partial_args.rs is the Rust twin, pinned by the same fixture.

/** One key and value pair. `open` is true while the value is still being written. */
export interface PartialArg {
  key: string;
  /** A string value is decoded. Anything else (number, object, array, literal) is its raw JSON text. */
  value: string;
  kind: "string" | "json";
  open: boolean;
}

export interface PartialArgsResult {
  entries: PartialArg[];
  /** The text stopped being a JSON object. Show the raw text instead of trusting the pairs. */
  invalid: boolean;
  /** The closing brace has arrived. */
  complete: boolean;
}

type State = "start" | "keyOrEnd" | "key" | "colon" | "value" | "str" | "nested" | "literal" | "after" | "done" | "bad";

const TAIL = 32;

function isSpace(c: string): boolean {
  return c === " " || c === "\n" || c === "\r" || c === "\t";
}

function isLineBreak(c: string): boolean {
  return c === "\n" || c === "\r" || c === " " || c === " ";
}

function isHex(c: string): boolean {
  return /^[0-9a-fA-F]$/.test(c);
}

/**
 * Resumes from its last offset, so a long value is scanned once however many chunks carry it.
 * Callers pass the whole text so far each time. Text that is not an extension of the last
 * call starts the scan over.
 */
export class PartialArgsScanner {
  /** Characters scanned in all. Tests use it to prove the scan resumes. */
  scanned = 0;
  private pos = 0;
  private tail = "";
  private state: State = "start";
  private entries: PartialArg[] = [];
  private keyBuf = "";
  private inKey = false;
  private esc = 0;
  private hex = "";
  private high = 0;
  private depth = 0;
  private nestInStr = false;
  private nestEsc = false;

  update(text: string): PartialArgsResult {
    if (text.length < this.pos || !text.startsWith(this.tail, this.pos - this.tail.length)) this.reset();
    this.scanned += text.length - this.pos;
    this.scan(text);
    this.pos = text.length;
    this.tail = text.slice(Math.max(0, text.length - TAIL));
    return this.result();
  }

  private reset() {
    this.pos = 0;
    this.tail = "";
    this.state = "start";
    this.entries = [];
    this.keyBuf = "";
    this.inKey = false;
    this.esc = 0;
    this.hex = "";
    this.high = 0;
    this.depth = 0;
    this.nestInStr = false;
    this.nestEsc = false;
  }

  private result(): PartialArgsResult {
    return {
      entries: this.entries.map((e) => ({ ...e })),
      invalid: this.state === "bad",
      complete: this.state === "done",
    };
  }

  private cur(): PartialArg {
    return this.entries[this.entries.length - 1];
  }

  private put(s: string) {
    if (this.high) {
      const h = String.fromCharCode(this.high);
      this.high = 0;
      this.sink(h);
    }
    this.sink(s);
  }

  private sink(s: string) {
    if (this.inKey) this.keyBuf += s;
    else this.cur().value += s;
  }

  private unit(code: number) {
    if (this.high) {
      if (code >= 0xdc00 && code <= 0xdfff) {
        const pair = String.fromCharCode(this.high, code);
        this.high = 0;
        this.sink(pair);
        return;
      }
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      this.put("");
      this.high = code;
      return;
    }
    this.put(String.fromCharCode(code));
  }

  /** Feeds one character to the open string. Returns true when the string ended. */
  private strChar(c: string): boolean {
    if (this.esc === 1) {
      this.esc = 0;
      // A backslash before a raw line break ends the string. Models cut off mid-escape do this.
      if (isLineBreak(c)) {
        this.put("");
        return true;
      }
      switch (c) {
        case "n": this.put("\n"); break;
        case "r": this.put("\r"); break;
        case "t": this.put("\t"); break;
        case '"': this.put('"'); break;
        case "\\": this.put("\\"); break;
        case "/": this.put("/"); break;
        case "b": this.put("b"); break;
        case "f": this.put("f"); break;
        case "u": this.esc = 2; this.hex = ""; break;
        default: this.put("\\" + c);
      }
      return false;
    }
    if (this.esc === 2) {
      if (isHex(c)) {
        this.hex += c;
        if (this.hex.length === 4) {
          this.esc = 0;
          this.unit(parseInt(this.hex, 16));
        }
        return false;
      }
      this.put("\\u" + this.hex);
      this.esc = 0;
    }
    if (c === "\\") {
      this.esc = 1;
      return false;
    }
    if (c === '"') {
      this.put("");
      return true;
    }
    this.put(c);
    return false;
  }

  private endKey() {
    this.inKey = false;
    this.state = "colon";
  }

  private endValue() {
    this.cur().open = false;
    this.state = "after";
  }

  private scan(text: string) {
    const n = text.length;
    let i = this.pos;
    while (i < n) {
      const c = text[i];
      switch (this.state) {
        case "start":
          if (isSpace(c)) i++;
          else if (c === "{") { this.state = "keyOrEnd"; i++; }
          else this.state = "bad";
          break;
        case "keyOrEnd":
          if (isSpace(c)) i++;
          else if (c === '"') { this.state = "key"; this.inKey = true; this.keyBuf = ""; this.esc = 0; i++; }
          else if (c === "}") { this.state = "done"; i++; }
          else this.state = "bad";
          break;
        case "colon":
          if (isSpace(c)) i++;
          else if (c === ":") { this.state = "value"; i++; }
          else this.state = "bad";
          break;
        case "value":
          if (isSpace(c)) { i++; break; }
          if (c === "}" || c === "," || c === "]" || c === ":") { this.state = "bad"; break; }
          if (c === '"') {
            this.entries.push({ key: this.keyBuf, value: "", kind: "string", open: true });
            this.state = "str";
            this.esc = 0;
          } else if (c === "{" || c === "[") {
            this.entries.push({ key: this.keyBuf, value: c, kind: "json", open: true });
            this.state = "nested";
            this.depth = 1;
            this.nestInStr = false;
            this.nestEsc = false;
          } else {
            this.entries.push({ key: this.keyBuf, value: c, kind: "json", open: true });
            this.state = "literal";
          }
          i++;
          break;
        case "key":
        case "str": {
          // Plain runs are copied in one slice, so a large file body costs one append per chunk.
          if (this.esc === 0 && !this.high) {
            let j = i;
            while (j < n && text[j] !== '"' && text[j] !== "\\") j++;
            if (j > i) { this.sink(text.slice(i, j)); i = j; break; }
          }
          const ended = this.strChar(c);
          i++;
          if (ended) {
            if (this.state === "key") this.endKey();
            else this.endValue();
          }
          break;
        }
        case "nested": {
          const v = this.cur();
          v.value += c;
          i++;
          if (this.nestInStr) {
            if (this.nestEsc) this.nestEsc = false;
            else if (c === "\\") this.nestEsc = true;
            else if (c === '"') this.nestInStr = false;
          } else if (c === '"') this.nestInStr = true;
          else if (c === "{" || c === "[") this.depth++;
          else if (c === "}" || c === "]") {
            this.depth--;
            if (this.depth === 0) this.endValue();
          }
          break;
        }
        case "literal":
          if (isSpace(c)) { this.endValue(); i++; }
          else if (c === ",") { this.cur().open = false; this.state = "keyOrEnd"; i++; }
          else if (c === "}") { this.cur().open = false; this.state = "done"; i++; }
          else if (c === '"' || c === "{" || c === "[" || c === ":") this.state = "bad";
          else { this.cur().value += c; i++; }
          break;
        case "after":
          if (isSpace(c)) i++;
          else if (c === ",") { this.state = "keyOrEnd"; i++; }
          else if (c === "}") { this.state = "done"; i++; }
          else this.state = "bad";
          break;
        case "done":
          if (isSpace(c)) i++;
          else this.state = "bad";
          break;
        case "bad":
          i = n;
          break;
      }
    }
  }
}

/** One-shot parse of the text so far. */
export function parsePartialArgs(text: string): PartialArgsResult {
  return new PartialArgsScanner().update(text);
}

/** The first pair whose key is one of `keys`, in text order. */
export function firstArg(result: PartialArgsResult, keys: readonly string[]): PartialArg | undefined {
  return result.entries.find((e) => keys.includes(e.key));
}
