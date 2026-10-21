// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FilePreview } from "../chat/FilePreview";

/** Exercises mini previews for created spreadsheets, slide decks, documents, and code. */

afterEach(() => {
  cleanup();
});

describe("FilePreview spreadsheet view", () => {
  it("renders a CSV as an interactive table grid with headers and counts", () => {
    const csv = "Name,Role,Score\nAlice,Engineer,95\nBob,Designer,88";
    render(<FilePreview filename="team.csv" content={csv} />);

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Designer")).toBeTruthy();
    expect(screen.getByText("3 rowCount · 3 columnCount")).toBeTruthy();
  });

  it("renders an HTML table as a spreadsheet preview", () => {
    const html = "<table><tr><th>Month</th><th>Revenue</th></tr><tr><td>Jan</td><td>1000</td></tr></table>";
    render(<FilePreview filename="finance.xlsx" content={html} />);

    expect(screen.getByText("Month")).toBeTruthy();
    expect(screen.getByText("Jan")).toBeTruthy();
    expect(screen.getByText("1000")).toBeTruthy();
  });
});

describe("FilePreview presentation view", () => {
  it("renders Markdown slide deck with titles and bullet points", () => {
    const deck = "# Intro\n- Welcome\n- Overview\n---\n# Architecture\n- Core\n- Renderer";
    render(<FilePreview filename="slides.pptx" content={deck} />);

    expect(screen.getByText("Intro")).toBeTruthy();
    expect(screen.getByText("Architecture")).toBeTruthy();
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("2 slideCount")).toBeTruthy();
  });

  it("renders HTML slides with section elements", () => {
    const html = "<section><h1>Slide One</h1><p>Point A</p></section><section><h2>Slide Two</h2><p>Point B</p></section>";
    render(<FilePreview filename="pitch.pptx" content={html} />);

    expect(screen.getByText("Slide One")).toBeTruthy();
    expect(screen.getByText("Slide Two")).toBeTruthy();
    expect(screen.getByText("Point A")).toBeTruthy();
  });
});

/** Counts every box in a subtree that would grow its own scrollbar. */
function scrollers(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll("*")).filter((element) => {
    const inline = element.getAttribute("style") || "";
    const classes = element.className?.toString() || "";
    return (
      /overflow(-[xy])?\s*:\s*(auto|scroll)/.test(inline) ||
      /\boverflow(-[xy])?-(auto|scroll)\b/.test(classes)
    );
  });
}

describe("FilePreview scrolling", () => {
  const long = Array.from({ length: 221 }, (_, i) => `const line${i} = ${i};`).join("\n");

  /** The box scrolled, the highlighter's own pre scrolled inside it, and the card scrolled around
   * both: three bars down one edge for one file. */
  it("gives a long code file exactly one scrollbar", () => {
    const { container } = render(<FilePreview filename="organizer.py" content={long} />);

    expect(scrollers(container).length).toBe(1);
  });

  /** The spacer that holds the scroll height is unshrinkable. As a flex child the code was
   * squashed to a single line and the rest of the card was empty. */
  it("shows the windowed code rather than collapsing it to one line", () => {
    const { container } = render(<FilePreview filename="organizer.py" content={long} />);

    expect(container.textContent).toContain("const line0");
    expect(container.textContent).toContain("const line40");
  });
});

describe("FilePreview HTML documents", () => {
  /** A .docx is written as HTML. Handed to the Markdown renderer its indentation became a code
   * block, so the document previewed as its own source. */
  it("renders a docx written as HTML as the document itself", () => {
    const html = `
      <div class="page">
        <h1>Quarterly Report</h1>
        <p>Revenue rose by <strong>12%</strong>.</p>
      </div>
    `;
    const { container } = render(<FilePreview filename="report.docx" content={html} />);

    expect(container.querySelector("h1")?.textContent).toBe("Quarterly Report");
    expect(container.querySelector("strong")?.textContent).toBe("12%");
    expect(container.textContent).not.toContain("<h1>");
  });

  it("renders an html file as the page rather than as source", () => {
    const { container } = render(
      <FilePreview filename="page.html" content="<h2>Hello</h2><p>World</p>" />,
    );

    expect(container.querySelector("h2")?.textContent).toBe("Hello");
  });

  it("drops anything in the markup that could act rather than show", () => {
    const html =
      '<div><script>window.stolen = 1</script><style>p{color:red}</style>' +
      '<p onclick="steal()" style="color: #008000">Safe</p>' +
      '<a href="javascript:steal()">Link</a></div>';
    const { container } = render(<FilePreview filename="note.docx" content={html} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelector("p")?.getAttribute("onclick")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBeNull();

    // What is left still looks like the document it will become.
    expect(container.querySelector("p")?.getAttribute("style")).toContain("008000");
    expect(container.textContent).toContain("Safe");
  });

  it("still renders a Markdown document as Markdown", () => {
    render(<FilePreview filename="notes.md" content={"# Heading\n\nSome **bold** text."} />);

    expect(screen.getByText("Heading")).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
  });
});

describe("FilePreview markdown and code view", () => {
  it("renders formatted markdown for document files", () => {
    const doc = "# Project Spec\n\nThis is a **bold** document.";
    render(<FilePreview filename="spec.docx" content={doc} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
  });

  it("renders styled HTML for PDF documents", () => {
    const html = "<h1 style='color: blue;'>Invoice PDF</h1><p>Thank you</p>";
    render(<FilePreview filename="invoice.pdf" content={html} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Invoice PDF")).toBeTruthy();
    expect(screen.getByText("Thank you")).toBeTruthy();
  });

  it("renders code files with syntax highlighting", () => {
    const code = "const message = 'hello world';";
    render(<FilePreview filename="script.ts" content={code} fullHeight />);

    expect(screen.getByText(/hello world/)).toBeTruthy();
  });

  it("windows very large code files to protect UI responsiveness without truncating", () => {
    const largeCode = Array.from({ length: 600 }, (_, i) => `console.log("line ${i}");`).join("\n");
    render(<FilePreview filename="large.js" content={largeCode} />);

    expect(screen.queryByText(/Showing first 400/)).toBeNull();
    expect(screen.getByText(/line 0/)).toBeTruthy();
  });

  it("renders extensionless files as plain text without markdown or syntax highlighting", () => {
    const license = "# MIT License\n**Copyright (c) 2026**\nAll rights reserved.";
    render(<FilePreview filename="LICENSE" content={license} />);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText(/# MIT License/)).toBeTruthy();
    expect(screen.getByText(/\*\*Copyright/)).toBeTruthy();
  });
});

describe("FilePreview live generation mode (isWriting)", () => {
  it("renders streaming Word HTML document with unclosed style and active caret", () => {
    const partialHtml = "<style>body { font-family: sans-serif; }\n<h1>Draft Project Plan</h1>\n<p>Initial draft";
    const { container } = render(<FilePreview filename="plan.docx" content={partialHtml} isWriting />);

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Draft Project Plan")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
  });

  it("renders streaming Markdown document with native markdown layout and caret", () => {
    const partialMd = "# Live Spec\n\n- Feature 1\n- Feature 2";
    const { container } = render(<FilePreview filename="spec.md" content={partialMd} isWriting />);

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Feature 1")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
    expect(container.querySelector(".bg-\\[\\#e9e9ec\\]")).toBeNull();
  });

  it("renders empty streaming spreadsheet with active cell highlight instead of preview unavailable", () => {
    const { container } = render(<FilePreview filename="data.xlsx" content="" isWriting />);

    expect(screen.queryByText("previewUnavailable")).toBeNull();
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
  });

  it("renders streaming presentation slide deck with active slide highlight", () => {
    const partialDeck = "# Slide One\n- Item A";
    const { container } = render(<FilePreview filename="pitch.pptx" content={partialDeck} isWriting />);

    expect(screen.queryByText("previewUnavailable")).toBeNull();
    expect(screen.getByText("Slide One")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
  });

  it("renders an html file on a white page with no browser bar around it", () => {
    const html = "<style>h1 { color: #0066cc; }</style><h1>Landing Page</h1><p>Welcome to our site.</p>";
    const { container } = render(<FilePreview filename="index.html" content={html} />);

    expect(screen.queryByText(/localhost:3000/)).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Landing Page")).toBeTruthy();

    const canvas = container.querySelector(".chrome-html-canvas");
    expect(canvas).toBeTruthy();
    expect(canvas?.classList.contains("bg-white")).toBe(true);
    expect(canvas?.classList.contains("markdown-body")).toBe(false);

    // Style is scoped inside the canvas rather than dropped
    const styleEl = container.querySelector("style");
    expect(styleEl).toBeTruthy();
    expect(styleEl?.textContent).toContain("@scope (.chrome-html-canvas)");
    expect(styleEl?.textContent).toContain("color: #0066cc");
  });

  it("renders streaming html page with white canvas and active caret", () => {
    const partialHtml = "<h1>Streaming Site</h1><p>Loading content";
    const { container } = render(<FilePreview filename="app.html" content={partialHtml} isWriting />);

    expect(screen.queryByText(/localhost:3000/)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(container.querySelector(".chrome-html-canvas.bg-white")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
  });
});


