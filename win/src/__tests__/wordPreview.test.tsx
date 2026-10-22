// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Document, Packer, PageBreak, Paragraph, TextRun } from "docx";
import { WordPreview } from "../chat/WordPreview";

// A Word file is drawn as pages from its own bytes, not as the text pulled out of it.

async function twoPageDoc(): Promise<string> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: "First page", bold: true })] }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph("Second page"),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc)).toString("base64");
}

describe("a Word file preview", () => {
  it("draws its text with the file's own formatting and a break between pages", async () => {
    const onFail = vi.fn();
    const { container } = render(<WordPreview base64={await twoPageDoc()} onFail={onFail} />);

    await waitFor(() => expect(container.querySelector("[data-ready='true']")).toBeTruthy());
    expect(container.textContent).toContain("First page");
    expect(container.textContent).toContain("Second page");
    expect(container.querySelectorAll("section.word-page").length).toBeGreaterThanOrEqual(2);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("hands back to the text view when the bytes are not a Word file", async () => {
    const onFail = vi.fn();
    render(<WordPreview base64={btoa("not a zip")} onFail={onFail} />);

    await waitFor(() => expect(onFail).toHaveBeenCalled());
  });
});
