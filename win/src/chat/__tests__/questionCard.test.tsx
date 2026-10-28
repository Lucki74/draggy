/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionCard } from "../components/QuestionCard";
import type { QuestionSession } from "../questionTypes";

const t = (key: string) => {
  const map: Record<string, string> = {
    "question.singleSelect": "Single choice",
    "question.multiSelect": "Multiple choices",
    "question.text": "Your answer",
    "question.next": "Next",
    "question.submit": "Submit",
    "question.send": "Send",
    "question.skip": "Skip",
    "question.progress": "{current} of {total}",
    "question.requiresAction": "Requires your intervention",
    "question.selectedCount": "{count} selected",
    "question.placeholderText": "Type your answer...",
    "question.timeout": "Question expired",
    "question.sessionCompleted": "Completed",
  };
  return map[key] || key;
};

describe("QuestionCard component", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders single-select question with options and submits answer", () => {
    const session: QuestionSession = {
      id: "sess_1",
      chatId: "chat_1",
      workspaceId: "default",
      status: "active",
      currentIndex: 0,
      startedAt: Date.now(),
      answers: [],
      questions: [
        {
          id: "q1",
          type: "single",
          text: "What is your preference?",
          options: [
            { id: "opt1", label: "Option One", description: "First choice" },
            { id: "opt2", label: "Option Two" },
          ],
          required: true,
          context: "Context info",
          createdAt: Date.now(),
        },
      ],
    };

    const handleAnswer = vi.fn();
    const handleComplete = vi.fn();

    render(
      <QuestionCard
        session={session}
        onAnswer={handleAnswer}
        onComplete={handleComplete}
        t={t}
      />,
    );

    expect(screen.getByText("What is your preference?")).toBeDefined();
    expect(screen.getByText("Option One")).toBeDefined();
    expect(screen.getByText("First choice")).toBeDefined();
    expect(screen.getByText("Single choice")).toBeDefined();

    // Required question should not have skip button
    expect(screen.queryByText("Skip")).toBeNull();

    // Select option 1
    fireEvent.click(screen.getByLabelText(/Option One/i));

    // Submit button should now be enabled and say "Send" (since last question)
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDefined();
    fireEvent.click(sendButton);

    expect(handleAnswer).toHaveBeenCalledWith("q1", "opt1");
    expect(handleComplete).toHaveBeenCalled();
  });

  it("renders multi-select question with checkboxes and selected count", () => {
    const session: QuestionSession = {
      id: "sess_multi",
      chatId: "chat_1",
      workspaceId: "default",
      status: "active",
      currentIndex: 0,
      startedAt: Date.now(),
      answers: [],
      questions: [
        {
          id: "q_m",
          type: "multi",
          text: "Select features",
          options: [
            { id: "f1", label: "Feature 1" },
            { id: "f2", label: "Feature 2" },
          ],
          required: false,
          minSelections: 1,
          context: "",
          createdAt: Date.now(),
        },
      ],
    };

    const handleAnswer = vi.fn();
    const handleSkip = vi.fn();

    render(
      <QuestionCard
        session={session}
        onAnswer={handleAnswer}
        onSkip={handleSkip}
        t={t}
      />,
    );

    // Optional question has skip button
    const skipBtn = screen.getByRole("button", { name: "Skip" });
    expect(skipBtn).toBeDefined();

    // Toggle features
    fireEvent.click(screen.getByLabelText(/Feature 1/i));
    expect(screen.getByText("1 selected")).toBeDefined();

    fireEvent.click(screen.getByLabelText(/Feature 2/i));
    expect(screen.getByText("2 selected")).toBeDefined();

    // Submit
    const sendBtn = screen.getByRole("button", { name: "Send" });
    fireEvent.click(sendBtn);

    expect(handleAnswer).toHaveBeenCalledWith("q_m", ["f1", "f2"]);
  });

  it("renders open text question and submits on Ctrl+Enter", () => {
    const session: QuestionSession = {
      id: "sess_text",
      chatId: "chat_1",
      workspaceId: "default",
      status: "active",
      currentIndex: 0,
      startedAt: Date.now(),
      answers: [],
      questions: [
        {
          id: "q_txt",
          type: "text",
          text: "Any details?",
          required: false,
          context: "",
          createdAt: Date.now(),
        },
      ],
    };

    const handleAnswer = vi.fn();

    render(<QuestionCard session={session} onAnswer={handleAnswer} t={t} />);

    const textarea = screen.getByPlaceholderText("Type your answer...");
    fireEvent.change(textarea, { target: { value: "My custom answer" } });

    // Press Ctrl+Enter
    const card = screen.getByTestId("question-card");
    fireEvent.keyDown(card, { key: "Enter", ctrlKey: true });

    expect(handleAnswer).toHaveBeenCalledWith("q_txt", "My custom answer");
  });
});
