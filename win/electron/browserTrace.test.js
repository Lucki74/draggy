import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createTrace, plainUrl } = require("./browserTrace.cjs");

describe("console capture", () => {
  it("keeps level and text", () => {
    const trace = createTrace();
    trace.handle("Runtime.consoleAPICalled", { type: "warning", args: [{ value: "slow" }, { value: 3 }] });
    trace.handle("Runtime.exceptionThrown", { exceptionDetails: { exception: { description: "TypeError: x" } } });
    expect(trace.console()).toEqual([
      { level: "warn", text: "slow 3" },
      { level: "error", text: "TypeError: x" },
    ]);
  });

  it("drops the oldest past the limit", () => {
    const trace = createTrace({ max: 2 });
    for (const n of [1, 2, 3]) trace.handle("Runtime.consoleAPICalled", { type: "log", args: [{ value: n }] });
    expect(trace.console().map((l) => l.text)).toEqual(["2", "3"]);
  });
});

describe("network capture", () => {
  const request = (trace, id, url) => trace.handle("Network.requestWillBeSent", { requestId: id, request: { method: "GET", url } });

  it("joins a response to its request and hides the query", () => {
    const trace = createTrace();
    request(trace, "1", "https://a.test/api/me?token=secret");
    trace.handle("Network.responseReceived", { requestId: "1", response: { status: 200 } });
    expect(trace.network()).toEqual([{ method: "GET", url: "https://a.test/api/me", status: 200 }]);
  });

  it("lists only failures when asked", () => {
    const trace = createTrace();
    request(trace, "1", "https://a.test/ok");
    trace.handle("Network.responseReceived", { requestId: "1", response: { status: 200 } });
    request(trace, "2", "https://a.test/missing");
    trace.handle("Network.responseReceived", { requestId: "2", response: { status: 404 } });
    request(trace, "3", "https://a.test/down");
    trace.handle("Network.loadingFailed", { requestId: "3", errorText: "net::ERR_FAILED" });
    expect(trace.network(50, true).map((r) => r.url)).toEqual(["https://a.test/missing", "https://a.test/down"]);
  });

  it("clears both lists", () => {
    const trace = createTrace();
    trace.handle("Runtime.consoleAPICalled", { type: "log", args: [{ value: "x" }] });
    request(trace, "1", "https://a.test/");
    trace.clear();
    expect(trace.console()).toEqual([]);
    expect(trace.network()).toEqual([]);
  });
});

describe("plainUrl", () => {
  it("strips query and fragment", () => {
    expect(plainUrl("https://a.test/p?x=1#top")).toBe("https://a.test/p");
  });
});
