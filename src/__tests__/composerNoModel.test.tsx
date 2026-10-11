// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

/** On a first run with no model, the composer says why it cannot send and where to get one. */

afterEach(cleanup);

describe("the composer with no model loaded", () => {
  it("explains itself, keeps Send disabled and links to Models", () => {
    const onOpenSettings = vi.fn();
    render(<ComposerPreview model="" onOpenSettings={onOpenSettings} />);

    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(field.placeholder).toBe("Load a model to send messages");
    fireEvent.change(field, { target: { value: "hello" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Open Models" }));
    expect(onOpenSettings).toHaveBeenCalledWith("models");
  });

  it("still sends /image, since drawing never reaches the chat model", () => {
    const onSendMessage = vi.fn();
    const onImageCommand = vi.fn();
    render(<ComposerPreview model="" onSendMessage={onSendMessage} onImageCommand={onImageCommand} />);

    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "/image a dragon" } });
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);

    fireEvent.click(send);
    expect(onImageCommand).toHaveBeenCalledWith("a dragon", expect.anything());
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("says nothing once a model is loaded", () => {
    render(<ComposerPreview />);
    expect(screen.queryByRole("button", { name: "Open Models" })).toBeNull();
  });
});
