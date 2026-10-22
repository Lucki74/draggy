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
});
