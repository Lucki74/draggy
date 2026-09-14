// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilePreview } from "../chat/FilePreview";

/** Exercises mini previews for created spreadsheets, slide decks, documents, and code. */

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
    expect(screen.getByText("• Welcome")).toBeTruthy();
    expect(screen.getByText("2 slideCount")).toBeTruthy();
  });

  it("renders HTML slides with section elements", () => {
    const html = "<section><h1>Slide One</h1><p>Point A</p></section><section><h2>Slide Two</h2><p>Point B</p></section>";
    render(<FilePreview filename="pitch.pptx" content={html} />);

    expect(screen.getByText("Slide One")).toBeTruthy();
    expect(screen.getByText("Slide Two")).toBeTruthy();
    expect(screen.getByText("• Point A")).toBeTruthy();
  });
});

describe("FilePreview markdown and code view", () => {
  it("renders formatted markdown for document files", () => {
    const doc = "# Project Spec\n\nThis is a **bold** document.";
    render(<FilePreview filename="spec.docx" content={doc} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
  });

  it("renders code files with syntax highlighting", () => {
    const code = "const message = 'hello world';";
    render(<FilePreview filename="script.ts" content={code} />);

    expect(screen.getByText(/hello world/)).toBeTruthy();
  });
});
