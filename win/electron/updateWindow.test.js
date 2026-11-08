import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("update window page", () => {
  const { buildHtml } = require("./updateWindow.cjs");
  const colours = { background: "#0e1012", foreground: "#e7eaed", accent: "#d55e00" };

  it("shows the title and the theme colours", () => {
    const html = buildHtml(colours);
    expect(html).toContain("Updating Draggy");
    expect(html).toContain("background:#0e1012");
    expect(html).toContain("color:#e7eaed");
    expect(html).toContain("background:#d55e00");
  });

  it("escapes markup in the title and colours", () => {
    const html = buildHtml({ ...colours, title: "<script>alert(1)</script>", accent: '"><b>' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><b>');
    expect(html).toContain("&#60;script&#62;");
  });

  it("loads no external resources", () => {
    const html = buildHtml(colours);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src=|href=/i);
  });
});
