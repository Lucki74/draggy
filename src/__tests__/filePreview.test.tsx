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

