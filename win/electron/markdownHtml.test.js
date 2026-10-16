import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { escapeHtml, inlineHtml, markdownToHtml, buildDocument } =
  require("./markdownHtml.cjs");

describe("escaping", () => {
  it("escapes the characters that would change the markup", () => {
    expect(escapeHtml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("plain words")).toBe("plain words");
  });

  it("copes with nothing at all", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("inline formatting", () => {
  it("renders bold, italic and both together", () => {
    expect(inlineHtml("**b**")).toBe("<strong>b</strong>");
    expect(inlineHtml("*i*")).toBe("<em>i</em>");
    expect(inlineHtml("***x***")).toBe("<strong><em>x</em></strong>");
  });

  it("renders strikethrough", () => {
    expect(inlineHtml("~~gone~~")).toBe("<del>gone</del>");
  });

  it("renders a code span", () => {
    expect(inlineHtml("run `npm test` now")).toBe(
      "run <code>npm test</code> now",
    );
  });

  it("leaves markup inside a code span literal", () => {
    expect(inlineHtml("`**not bold**`")).toBe("<code>**not bold**</code>");
  });

  it("does not mistake a number for a code span", () => {
    // The placeholder used to be a bare index in spaces, which turned
    // "I have 3 apples" into a stray fragment of an unrelated code block.
    expect(inlineHtml("I have 3 apples")).toBe("I have 3 apples");
    expect(inlineHtml("`a` and 0 and `b`")).toBe(
      "<code>a</code> and 0 and <code>b</code>",
    );
  });

  it("escapes HTML the model wrote", () => {
    expect(inlineHtml("<img src=x onerror=alert(1)>")).toContain("&lt;img");
    expect(inlineHtml("<b>hi</b>")).not.toContain("<b>");
  });

  it("links http and https", () => {
    expect(inlineHtml("[site](https://example.com)")).toBe(
      '<a href="https://example.com">site</a>',
    );
  });

  it("keeps the words but drops any other scheme", () => {
    expect(inlineHtml("[click](javascript:alert)")).toBe("click");
    expect(inlineHtml("[file](file:///etc/passwd)")).toBe("file");
    expect(inlineHtml("[x](data:text/html,<script>)")).not.toContain("<a ");
  });

  it("stops a link at the first closing bracket", () => {
    // A URL with brackets of its own is not handled, and the tail is left as
    // text. Rare enough in a generated document to be worth the simpler rule.
    expect(inlineHtml("[a](https://e.com/x(1))")).toBe(
      '<a href="https://e.com/x(1">a</a>)',
    );
  });
});

describe("block structure", () => {
  it("renders headings at every level", () => {
    expect(markdownToHtml("# One")).toBe("<h1>One</h1>");
    expect(markdownToHtml("###### Six")).toBe("<h6>Six</h6>");
  });

  it("renders a paragraph", () => {
    expect(markdownToHtml("Just text.")).toBe("<p>Just text.</p>");
  });

  it("groups consecutive bullets into one list", () => {
    const html = markdownToHtml("- a\n- b\n- c");
    expect(html).toBe("<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ul>");
  });

  it("groups consecutive numbers into one ordered list", () => {
    const html = markdownToHtml("1. a\n2. b");
    expect(html).toBe("<ol>\n<li>a</li>\n<li>b</li>\n</ol>");
  });

  it("closes a list when the prose resumes", () => {
    const html = markdownToHtml("- a\n\nAfter.");
    expect(html).toBe("<ul>\n<li>a</li>\n</ul>\n<p>After.</p>");
  });

  it("starts a new list when the kind changes", () => {
    const html = markdownToHtml("- a\n1. b");
    expect(html).toContain("</ul>");
    expect(html).toContain("<ol>");
  });

  it("renders a horizontal rule", () => {
    expect(markdownToHtml("---")).toBe("<hr />");
    expect(markdownToHtml("***")).toBe("<hr />");
  });

  it("renders a blockquote", () => {
    expect(markdownToHtml("> quoted")).toBe("<blockquote>quoted</blockquote>");
  });

  it("keeps a fenced code block verbatim", () => {
    const html = markdownToHtml("```js\nconst a = 1 < 2;\n```");
    expect(html).toContain('data-language="js"');
    expect(html).toContain("const a = 1 &lt; 2;");
  });

  it("does not format inside a fenced block", () => {
    const html = markdownToHtml("```\n**not bold**\n```");
    expect(html).toContain("**not bold**");
    expect(html).not.toContain("<strong>");
  });

  it("closes an unterminated fence at the end of the document", () => {
    const html = markdownToHtml("```\nstill code");
    expect(html).toContain("<pre><code>still code</code></pre>");
  });

  it("renders a table with its header", () => {
    const html = markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("needs the separator row before it calls something a table", () => {
    // Otherwise a sentence with a pipe in it becomes a one-cell table.
    const html = markdownToHtml("a | b is a choice");
    expect(html).toBe("<p>a | b is a choice</p>");
  });

  it("handles an empty document", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml(null)).toBe("");
  });

  it("normalises Windows line endings", () => {
    expect(markdownToHtml("# A\r\n\r\nB")).toBe("<h1>A</h1>\n<p>B</p>");
  });
});

describe("the printable document", () => {
  const html = buildDocument("# Title\n\nBody text.", "report");

  it("is a complete page", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("carries the content", () => {
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body text.</p>");
  });

  it("titles the document after the file", () => {
    expect(html).toContain("<title>report</title>");
  });

  it("forbids the page from fetching anything", () => {
    // Belt to the escaping's braces: a document made from model output must
    // not be able to report that it was made, or to whom.
    expect(html).toContain("default-src 'none'");
  });

  it("sets a page size so the print is not letter by accident", () => {
    expect(html).toContain("@page");
    expect(html).toContain("A4");
  });

  it("escapes a title that contains markup", () => {
    expect(buildDocument("x", "<script>")).toContain("<title>&lt;script&gt;</title>");
  });
});

describe("HTML content in printable document", () => {
  it("frames an HTML fragment directly inside the page body", () => {
    const fragment = '<h1 style="color: blue;">Direct HTML</h1><p>Styled text</p>';
    const doc = buildDocument(fragment, "styled");

    expect(doc).toContain('<h1 style="color: blue;">Direct HTML</h1>');
    expect(doc).toContain("<p>Styled text</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<title>styled</title>");
  });

  it("injects security policy and print styles into a full HTML document", () => {
    const full = "<!doctype html><html><head><title>Custom</title></head><body><h1>Hi</h1></body></html>";
    const doc = buildDocument(full, "custom");

    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("A4");
    expect(doc).toContain("<h1>Hi</h1>");
  });

  it("strips script tags from HTML content", () => {
    const dangerous = '<h1>Hello</h1><script>alert("hack")</script>';
    const doc = buildDocument(dangerous, "safe");

    expect(doc).toContain("<h1>Hello</h1>");
    expect(doc).not.toContain("alert");
    expect(doc).not.toContain("<script>");
  });

  it("does not let removing one script join the text around it into another", () => {
    const joined = [
      "<scr<script></script>ipt>alert(1)</script>",
      "<scr<script></script><script></script>ipt>alert(1)</script>",
      "<<script></script>script>alert(1)</script>",
      "<scr<script>x</script>ipt>alert(1)</scr<script>x</script>ipt>",
    ];

    for (const html of joined) {
      const doc = buildDocument(`<h1>Hi</h1>${html}`, "t");
      expect(doc, html).not.toMatch(/<script/i);
      expect(doc, html).not.toMatch(/<\/script/i);
    }
  });

  it("does not leave an unclosed script tag to run to the end of the page", () => {
    const doc = buildDocument('<h1>Hi</h1><script>alert("hack")', "t");

    expect(doc).not.toMatch(/<script/i);
    expect(doc).toContain("&lt;script");
    expect(doc).toContain("<h1>Hi</h1>");
  });

  it("leaves ordinary HTML that only mentions scripts alone", () => {
    const doc = buildDocument("<p>Use a &lt;script&gt; tag, or the word script.</p>", "t");

    expect(doc).toContain("<p>Use a &lt;script&gt; tag, or the word script.</p>");
  });

  it("still strips a script whose closing tag a real browser accepts but this one used to miss", () => {
    // A browser ends the element as soon as it sees "</script" regardless of
    // what junk or whitespace follows before the ">". Requiring exactly
    // "</script>" let one written as "</script foo>" or split across a line
    // survive the strip with the payload still attached to it.
    const spaced = '<h1>Hello</h1><script>alert("hack")</script foo>';
    const newlined = '<h1>Hello</h1><script>alert("hack")</script\n>';

    for (const dangerous of [spaced, newlined]) {
      const doc = buildDocument(dangerous, "safe");
      expect(doc).toContain("<h1>Hello</h1>");
      expect(doc).not.toContain("alert");
      expect(doc).not.toContain("<script");
    }
  });
});
