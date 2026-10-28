// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

afterEach(cleanup);

describe("attachments after a send", () => {
  it("are handed over once and then cleared from the composer", () => {
    const onSendMessage = vi.fn();
    const clearAttachments = vi.fn();
    render(<ComposerPreview onSendMessage={onSendMessage} clearAttachments={clearAttachments} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "look at this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSendMessage).toHaveBeenCalledWith("look at this", [{ name: "screenshot.png", type: "image/png" }]);
    expect(clearAttachments).toHaveBeenCalledTimes(1);
  });

  it("renders an image preview for image attachments instead of a chip on top of the text", () => {
    render(<ComposerPreview />);
    const img = screen.getByRole("img", { name: "screenshot.png" });
    const textbox = screen.getByRole("textbox");
    expect(img).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove attachment" })).toBeTruthy();
    // Verify the image preview comes before the textbox in the DOM
    expect(img.compareDocumentPosition(textbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
