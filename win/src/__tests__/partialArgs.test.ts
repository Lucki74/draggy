import { describe, expect, it } from "vitest";
import { PartialArgsScanner, firstArg } from "../agent/partialArgs";

describe("PartialArgsScanner", () => {
  it("scans a 1 MB write in chunks without rescanning the prefix", () => {
    const body = "line of code with \\\"quotes\\\" and \\n breaks\\n".repeat(30000);
    const full = `{"filename": "big.txt", "content": "${body}"}`;
    const scanner = new PartialArgsScanner();
    let scanned = 0;
    const started = performance.now();
    for (let end = 4096; ; end += 4096) {
      const slice = full.slice(0, Math.min(end, full.length));
      scanned += slice.length;
      scanner.update(slice);
      if (end >= full.length) break;
    }
    const result = scanner.update(full);
    const elapsed = performance.now() - started;
    expect(result.complete).toBe(true);
    expect(firstArg(result, ["content"])?.value.length).toBeGreaterThan(900_000);
    // Rescanning every prefix would take seconds for this size.
    expect(elapsed).toBeLessThan(1500);
    expect(scanned).toBeGreaterThan(full.length);
    expect(scanner.scanned).toBe(full.length);
  });

  it("starts over when the text is not an extension of the last call", () => {
    const scanner = new PartialArgsScanner();
    scanner.update('{"a": "first');
    const result = scanner.update('{"b": "second"}');
    expect(result.entries).toEqual([{ key: "b", value: "second", kind: "string", open: false }]);
  });

  it("returns copies, so a held result does not change under the caller", () => {
    const scanner = new PartialArgsScanner();
    const first = scanner.update('{"a": "x');
    scanner.update('{"a": "xyz');
    expect(first.entries[0].value).toBe("x");
  });
});
