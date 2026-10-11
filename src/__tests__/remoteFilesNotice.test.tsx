// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RemoteFilesNotice from "../providers/RemoteFilesNotice";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;
const text = (provider: string) => `Files this model reads will be sent to ⁨${provider}⁩.`;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the notice that files leave the computer", () => {
  it("names the provider a project's files will be sent to", () => {
    render(<RemoteFilesNotice model="@openai/gpt-x" provider="OpenAI" inProject t={t} />);
    expect(screen.getByText(text("OpenAI"))).toBeTruthy();
  });

  it("stays away from the built-in engine and from a chat with no project", () => {
    const { container, rerender } = render(<RemoteFilesNotice model="qwen3-8b.gguf" inProject t={t} />);
    expect(container.textContent).toBe("");
    rerender(<RemoteFilesNotice model="@openai/gpt-x" provider="OpenAI" inProject={false} t={t} />);
    expect(container.textContent).toBe("");
  });

  it("is shown once: dismissed, it never comes back", () => {
    render(<RemoteFilesNotice model="@openai/gpt-x" provider="OpenAI" inProject t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(text("OpenAI"))).toBeNull();

    cleanup();
    render(<RemoteFilesNotice model="@anthropic/claude-x" provider="Anthropic" inProject t={t} />);
    expect(screen.queryByText(text("Anthropic"))).toBeNull();
  });

  it("falls back to the instance's id when its label is not known yet", () => {
    render(<RemoteFilesNotice model="@groq/llama" inProject t={t} />);
    expect(screen.getByText(text("groq"))).toBeTruthy();
  });
});
