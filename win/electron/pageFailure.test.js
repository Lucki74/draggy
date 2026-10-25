import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyPageFailure } = require("./pageFailure.cjs");

describe("page failure", () => {
  it("tells a missing site from a dead network", () => {
    expect(classifyPageFailure(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://x.example'")).code).toBe("dns");
    expect(classifyPageFailure({ message: "ERR_INTERNET_DISCONNECTED" }).code).toBe("offline");
    expect(classifyPageFailure({ message: "ERR_CONNECTION_TIMED_OUT" }).code).toBe("timeout");
  });

  it("names a page that changed under the script", () => {
    expect(classifyPageFailure(new Error("Script failed to execute, this normally means an error was thrown.")).code).toBe("script");
  });

  it("falls back to a plain sentence", () => {
    expect(classifyPageFailure(new Error("odd")).reason).toBe("The page could not be opened.");
    expect(classifyPageFailure(undefined).code).toBe("unknown");
  });
});
