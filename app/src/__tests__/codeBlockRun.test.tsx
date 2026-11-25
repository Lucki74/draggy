// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeBlock } from "../chat/CodeBlock";
import { onPrefill, resetTerminalBus, shellForLanguage } from "../terminal/terminalBus";

/** A shell code block offers Run in terminal; it fills a prompt and never runs anything. */

afterEach(() => {
  cleanup();
  resetTerminalBus();
});

describe("Run in terminal", () => {
  it("is offered for shell languages only", () => {
    render(<CodeBlock language="bash" value="ls" />);
    expect(screen.getByText("Run in terminal")).toBeTruthy();
    cleanup();
    render(<CodeBlock language="typescript" value="const a = 1" />);
    expect(screen.queryByText("Run in terminal")).toBeNull();
  });

  it("ignores a click a script made, since only a person's click may fill a prompt", () => {
    const seen = vi.fn();
    const dispose = onPrefill(seen);
    render(<CodeBlock language="powershell" value="Get-Date" />);

    fireEvent.click(screen.getByText("Run in terminal"));
    expect(seen).not.toHaveBeenCalled();
    dispose();
  });

  it("maps languages to shells", () => {
    expect(shellForLanguage("sh")).toBe("bash");
    expect(shellForLanguage("bat")).toBe("cmd");
    expect(shellForLanguage("python")).toBeUndefined();
  });
});
