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
