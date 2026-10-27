/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionSessionBar } from "../components/QuestionSessionBar";
import { QuestionHistoryCard } from "../components/QuestionHistoryCard";
import type { QuestionSession } from "../questionTypes";

const t = (key: string) => {
  const map: Record<string, string> = {
    "question.sessionBar": "Question session",
    "question.sessionCompleted": "Question session completed",
    "question.requiresAction": "Requires your intervention",
    "question.timeout": "Question expired",
    "question.viewAll": "View All",
    "question.expandAnswers": "Show answers",
    "question.collapseAnswers": "Hide answers",
  };
  return map[key] || key;
};

describe("QuestionSessionBar & QuestionHistoryCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders QuestionSessionBar with progress and handles dismiss", () => {
    const session: QuestionSession = {
      id: "sess_bar",
      chatId: "chat_1",
      workspaceId: "default",
      status: "active",
      currentIndex: 0,
      startedAt: Date.now(),
      answers: [{ questionId: "q1", type: "single", value: "opt1", submittedAt: Date.now() }],
      questions: [
        { id: "q1", type: "single", text: "Q1", required: true, context: "", createdAt: Date.now() },
        { id: "q2", type: "text", text: "Q2", required: false, context: "", createdAt: Date.now() },
      ],
    };

    const handleViewAll = vi.fn();
    const handleDismiss = vi.fn();

    render(
      <QuestionSessionBar
        session={session}
        onViewAll={handleViewAll}
        onDismiss={handleDismiss}
        t={t}
      />,
    );

    expect(screen.getByText("Requires your intervention")).toBeDefined();
    expect(screen.getByText(/1\/2/)).toBeDefined();

    const viewAllBtn = screen.getByRole("button", { name: "View All" });
    fireEvent.click(viewAllBtn);
    expect(handleViewAll).toHaveBeenCalled();

    const dismissBtn = screen.getByRole("button", { name: "Dismiss session bar" });
    fireEvent.click(dismissBtn);
    expect(handleDismiss).toHaveBeenCalled();
  });

  it("renders QuestionHistoryCard and toggles expanded answers", () => {
    const session: QuestionSession = {
      id: "sess_history",
      chatId: "chat_1",
      workspaceId: "default",
      status: "completed",
      currentIndex: 1,
      startedAt: Date.now(),
      completedAt: Date.now(),
      questions: [
        {
          id: "q1",
          type: "single",
          text: "Preferred framework?",
          options: [{ id: "react", label: "React" }],
          required: true,
          context: "",
          createdAt: Date.now(),
        },
      ],
      answers: [{ questionId: "q1", type: "single", value: "react", submittedAt: Date.now() }],
    };

    render(<QuestionHistoryCard session={session} t={t} />);

    expect(screen.getByText(/Question session completed: 1/)).toBeDefined();
    expect(screen.getByText("Show answers")).toBeDefined();

    // Click to expand
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Hide answers")).toBeDefined();
    expect(screen.getByText("1. Preferred framework?")).toBeDefined();
    expect(screen.getByText("React")).toBeDefined();
  });
});
