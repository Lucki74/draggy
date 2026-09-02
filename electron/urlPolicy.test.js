import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isFetchableUrl,
  isPrivateHostname,
  refusalFor,
} = require("./urlPolicy.cjs");

describe("isFetchableUrl", () => {
  it("allows ordinary web pages", () => {
    expect(isFetchableUrl("https://example.com")).toBe(true);
    expect(isFetchableUrl("http://example.com/path?q=1#top")).toBe(true);
    expect(isFetchableUrl("https://sub.domain.example.co.uk/a/b")).toBe(true);
  });

  it("refuses local files, which is the whole point", () => {
    expect(isFetchableUrl("file:///C:/Users/someone/.aws/credentials")).toBe(false);
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("FILE:///etc/passwd")).toBe(false);
  });

  it("refuses the app's own schemes", () => {
    expect(isFetchableUrl("app://draggy/index.html")).toBe(false);
    expect(isFetchableUrl("draggy://models/config.json")).toBe(false);
    expect(isFetchableUrl("draggy://favicon/example.com")).toBe(false);
  });

  it("refuses schemes that execute or embed rather than fetch", () => {
    expect(isFetchableUrl("javascript:alert(1)")).toBe(false);
    expect(isFetchableUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isFetchableUrl("blob:https://example.com/abc")).toBe(false);
    expect(isFetchableUrl("about:blank")).toBe(false);
    expect(isFetchableUrl("devtools://devtools/bundled/inspector.html")).toBe(false);
    expect(isFetchableUrl("chrome://settings")).toBe(false);
    expect(isFetchableUrl("ftp://example.com/file.txt")).toBe(false);
    expect(isFetchableUrl("ws://example.com")).toBe(false);
  });

  it("refuses control characters smuggled into a scheme", () => {
    expect(isFetchableUrl("java\nscript:alert(1)")).toBe(false);
    expect(isFetchableUrl("java\tscript:alert(1)")).toBe(false);
    expect(isFetchableUrl("https://example.com\u0000")).toBe(false);
  });

  it("refuses what is not a URL at all", () => {
    expect(isFetchableUrl("")).toBe(false);
    expect(isFetchableUrl("   ")).toBe(false);
    expect(isFetchableUrl("example.com")).toBe(false);
    expect(isFetchableUrl("not a url")).toBe(false);
    expect(isFetchableUrl(null)).toBe(false);
    expect(isFetchableUrl(undefined)).toBe(false);
    expect(isFetchableUrl(42)).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isFetchableUrl("  https://example.com  ")).toBe(true);
  });

  it("refuses this machine and its network by default", () => {
    expect(isFetchableUrl("http://localhost:3000")).toBe(false);
    expect(isFetchableUrl("http://127.0.0.1:11434/api/tags")).toBe(false);
    expect(isFetchableUrl("http://[::1]:8080")).toBe(false);
    expect(isFetchableUrl("http://192.168.1.1/admin")).toBe(false);
    expect(isFetchableUrl("http://10.0.0.5")).toBe(false);
    expect(isFetchableUrl("http://172.16.4.2")).toBe(false);
    expect(isFetchableUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isFetchableUrl("http://printer.local")).toBe(false);
  });

  it("allows this machine when the user asked for it themselves", () => {
    expect(isFetchableUrl("http://localhost:3000", { allowPrivate: true })).toBe(true);
    expect(
      isFetchableUrl("http://127.0.0.1:5173", { allowPrivate: true }),
    ).toBe(true);
    // The scheme rule is not relaxed along with it.
    expect(
      isFetchableUrl("file:///etc/passwd", { allowPrivate: true }),
    ).toBe(false);
  });

  it("does not mistake a public address for a private one", () => {
    expect(isFetchableUrl("https://172.32.0.1")).toBe(true);
    expect(isFetchableUrl("https://11.0.0.1")).toBe(true);
    expect(isFetchableUrl("https://192.169.1.1")).toBe(true);
    expect(isFetchableUrl("https://169.253.1.1")).toBe(true);
    expect(isFetchableUrl("https://localhostings.com")).toBe(true);
    expect(isFetchableUrl("https://notlocal.example.com")).toBe(true);
  });
});

describe("isPrivateHostname", () => {
  it("recognises loopback in its several spellings", () => {
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("LOCALHOST")).toBe(true);
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("127.1.2.3")).toBe(true);
    expect(isPrivateHostname("0.0.0.0")).toBe(true);
    expect(isPrivateHostname("[::1]")).toBe(true);
    expect(isPrivateHostname("0:0:0:0:0:0:0:1")).toBe(true);
  });

  it("recognises unique-local IPv6", () => {
    expect(isPrivateHostname("fd00:1234::1")).toBe(true);
    expect(isPrivateHostname("fc00::1")).toBe(true);
  });

  it("leaves public hostnames alone", () => {
    expect(isPrivateHostname("example.com")).toBe(false);
    expect(isPrivateHostname("8.8.8.8")).toBe(false);
    expect(isPrivateHostname("2606:4700::1111")).toBe(false);
  });

  it("does not treat an out-of-range quad as an address", () => {
    expect(isPrivateHostname("999.999.999.999")).toBe(false);
  });
});

describe("refusalFor", () => {
  it("names the scheme so the model stops trying variations", () => {
    const message = refusalFor("file:///etc/passwd");
    expect(message).toContain("file:");
    expect(message.toLowerCase()).toContain("http");
  });

  it("explains a local address without naming the scheme", () => {
    expect(refusalFor("http://192.168.0.1")).toContain("local network");
  });

  it("says plainly when the string was never a URL", () => {
    expect(refusalFor("not a url")).toContain("not a valid web address");
  });
});
