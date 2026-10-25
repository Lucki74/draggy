// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssistantTurn, type AssistantTurnProps } from "../chat/AssistantTurn";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import type { Message, SearchStep } from "../types";

afterEach(cleanup);

const t = (key: string) => translations.en[key] || key;

const baseMessage = (extra: Partial<Message> = {}): Message => ({
  id: "m1",
  role: "assistant",
  content: "Partial answer",
  ...extra,
});

function renderTurn(
  message: Message,
  overrides: Partial<AssistantTurnProps> = {},
  steps: SearchStep[] = [],
) {
  const props: AssistantTurnProps = {
    msg: message,
    displayMsg: message,
    idx: 0,
    text: message.content,
    steps,
    live: false,
    isGenerating: false,
    isLast: true,
    onRegenerate: vi.fn(),
    onResume: vi.fn(),
    onSwitchVersion: vi.fn(),
    copiedIndex: null,
    copyToClipboard: vi.fn(),
    settings: defaultSettings,
    totalVersions: 1,
    currentVersionIndex: 0,
    currentVersionNum: 1,
    t,
    ...overrides,
  };
  render(<AssistantTurn {...props} />);
  return props;
}

describe("failed replies", () => {
  it("shows a friendly line per error kind with the raw error muted", () => {
    renderTurn(baseMessage({ failed: true, errorKind: "network", error: "ECONNRESET 42" }));

    expect(screen.getByText(t("errorKindNetwork"))).toBeTruthy();
    expect(screen.getByText("ECONNRESET 42").className).toContain("text-text-tertiary");
    expect(screen.getByText("Partial answer")).toBeTruthy();
  });

  it("shows only the error text for an unknown kind", () => {
    renderTurn(baseMessage({ failed: true, errorKind: "unknown", error: "Something broke" }));

    expect(screen.getByText("Something broke")).toBeTruthy();
    expect(screen.queryByText(t("errorKindEngine"))).toBeNull();
  });

  it("retries through the regenerate handler", () => {
    const props = renderTurn(baseMessage({ failed: true, errorKind: "engine", error: "crash" }));

    fireEvent.click(screen.getByRole("button", { name: t("regenerateResponse") }));
    expect(props.onRegenerate).toHaveBeenCalledWith(0);
  });

});

describe("stopped and interrupted replies", () => {
  it("labels a stopped reply and continues it", () => {
    const props = renderTurn(baseMessage({ stopped: true }));

    expect(screen.getByText(t("replyStopped"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("continueGenerating") }));
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });

  it("labels an interrupted reply and resumes it", () => {
    const props = renderTurn(baseMessage({ interrupted: true }));

    expect(screen.getByText(t("replyInterrupted"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("resumeReply") }));
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });
});

describe("steer steps", () => {
  it("renders a user note row with its text", () => {
    const steps: SearchStep[] = [
      { id: "s1", type: "steer", content: "Use metric units" },
    ];
    renderTurn(baseMessage(), {}, steps);

    expect(screen.getByText(t("steerNote"))).toBeTruthy();
    expect(screen.getByText("Use metric units")).toBeTruthy();
  });
});

describe("versions", () => {
  it("still shows the version counter and ignores the tail field", () => {
    const message = baseMessage({
      versions: [
        { content: "One", tail: [] },
        { content: "Two", tail: [] },
      ],
    });
    renderTurn(message, { totalVersions: 2, currentVersionIndex: 1, currentVersionNum: 2 });

    expect(screen.getByText("2 / 2")).toBeTruthy();
  });
});
