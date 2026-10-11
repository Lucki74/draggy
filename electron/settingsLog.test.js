import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { describeChange, describeKeySave } = createRequire(import.meta.url)("./settingsLog.cjs");

describe("describeChange", () => {
  it("carries old and new value for a harmless key", () => {
    expect(describeChange('{"theme":"light"}', '{"theme":"dark"}')).toEqual({ theme: { from: "light", to: "dark" } });
  });

  it("names a free-text key and never shows its value", () => {
    const changed = describeChange('{"customInstructions":["a"]}', '{"customInstructions":["my secret rule"]}');
    expect(changed).toEqual({ customInstructions: null });
    expect(JSON.stringify(changed)).not.toContain("secret");
  });

  it("is empty when nothing moved and survives bad input", () => {
    expect(describeChange('{"theme":"dark"}', '{"theme":"dark"}')).toEqual({});
    expect(describeChange("not json", null)).toEqual({});
  });
});

describe("describeKeySave", () => {
  it("names the key written outside the settings blob and carries no value", () => {
    expect(describeKeySave("api_config")).toEqual({ key: "api_config" });
  });
});
