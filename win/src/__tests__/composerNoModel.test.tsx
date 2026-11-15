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

  it("sends /image to the chat model as an instruction", () => {
    const onSendMessage = vi.fn();
    render(<ComposerPreview onSendMessage={onSendMessage} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/image a dragon" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSendMessage).toHaveBeenCalledWith("Generate an image: a dragon", expect.anything());
  });

  it("says nothing once a model is loaded", () => {
    render(<ComposerPreview />);
    expect(screen.queryByRole("button", { name: "Open Models" })).toBeNull();
  });
});
