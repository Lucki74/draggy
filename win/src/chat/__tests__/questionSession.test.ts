import { beforeEach, describe, expect, it } from "vitest";
import { questionSessionStore } from "../../store/questionSession";
import type { UserQuestion } from "../questionTypes";

describe("questionSessionStore", () => {
  beforeEach(() => {
    questionSessionStore._clearAll();
  });

  it("creates a new session with initial defaults", async () => {
    const session = await questionSessionStore.createSession("chat-123", "default", { test: true });
    expect(session.id).toBeDefined();
    expect(session.chatId).toBe("chat-123");
    expect(session.workspaceId).toBe("default");
    expect(session.status).toBe("active");
    expect(session.questions).toEqual([]);
    expect(session.answers).toEqual([]);
    expect(session.currentIndex).toBe(0);
    expect(session.startedAt).toBeGreaterThan(0);
    expect(session.metadata).toEqual({ test: true });

    const retrieved = await questionSessionStore.getSession(session.id);
    expect(retrieved).toEqual(session);
  });

  it("adds questions to an existing session", async () => {
    const session = await questionSessionStore.createSession("chat-123");

    const q1: UserQuestion = {
      id: "q1",
      type: "single",
      text: "Pick one",
      options: [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ],
      required: true,
      context: "context 1",
      createdAt: Date.now(),
    };

    const q2: UserQuestion = {
      id: "q2",
      type: "text",
      text: "Any thoughts?",
      required: false,
      context: "context 2",
      createdAt: Date.now(),
    };

    await questionSessionStore.addQuestion(session.id, q1);
    await questionSessionStore.addQuestion(session.id, q2);

    const updated = await questionSessionStore.getSession(session.id);
    expect(updated?.questions).toHaveLength(2);
    expect(updated?.questions[0].id).toBe("q1");
    expect(updated?.questions[1].id).toBe("q2");
  });

  it("submits answers and auto-advances currentIndex", async () => {
    const session = await questionSessionStore.createSession("chat-123");
    await questionSessionStore.addQuestion(session.id, {
      id: "q1",
      type: "single",
      text: "Q1",
      options: [{ id: "opt1", label: "Option 1" }],
      required: true,
      context: "",
      createdAt: Date.now(),
    });
    await questionSessionStore.addQuestion(session.id, {
      id: "q2",
      type: "text",
      text: "Q2",
      required: true,
      context: "",
      createdAt: Date.now(),
    });

    expect(session.currentIndex).toBe(0);

    // Answer Q1
    const s1 = await questionSessionStore.submitAnswer(session.id, {
      questionId: "q1",
      type: "single",
      value: "opt1",
      submittedAt: Date.now(),
    });

    expect(s1.answers).toHaveLength(1);
    expect(s1.answers[0].value).toBe("opt1");
    expect(s1.currentIndex).toBe(1); // auto-advanced to Q2
    expect(s1.status).toBe("active");

    // Answer Q2
    const s2 = await questionSessionStore.submitAnswer(session.id, {
      questionId: "q2",
      type: "text",
      value: "My feedback",
      submittedAt: Date.now(),
    });

    expect(s2.answers).toHaveLength(2);
    expect(s2.status).toBe("completed"); // all questions answered
    expect(s2.completedAt).toBeDefined();
  });

  it("handles skip logic for required vs optional questions", async () => {
    const session = await questionSessionStore.createSession("chat-123");
    await questionSessionStore.addQuestion(session.id, {
      id: "q_req",
      type: "single",
      text: "Required Question",
      options: [{ id: "1", label: "One" }],
      required: true,
      context: "",
      createdAt: Date.now(),
    });
    await questionSessionStore.addQuestion(session.id, {
      id: "q_opt",
      type: "text",
      text: "Optional Question",
      required: false,
      context: "",
      createdAt: Date.now(),
    });

    // Attempting to skip required question throws
    await expect(questionSessionStore.skipQuestion(session.id, "q_req")).rejects.toThrow(
      /required and cannot be skipped/,
    );

    // Answer q_req
    await questionSessionStore.submitAnswer(session.id, {
      questionId: "q_req",
      type: "single",
      value: "1",
      submittedAt: Date.now(),
    });

    // Skipping optional question succeeds
    const sSkipped = await questionSessionStore.skipQuestion(session.id, "q_opt");
    expect(sSkipped.status).toBe("completed");
  });

  it("completes a session explicitly", async () => {
    const session = await questionSessionStore.createSession("chat-123");
    const completed = await questionSessionStore.completeSession(session.id);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeGreaterThan(0);
  });

  it("handles session expiration (timeout)", async () => {
    const session = await questionSessionStore.createSession("chat-123");
    const expired = await questionSessionStore.expireSession(session.id);
    expect(expired.status).toBe("expired");
    expect(expired.completedAt).toBeDefined();
  });

  it("supports navigation (currentIndex)", async () => {
    const session = await questionSessionStore.createSession("chat-123");
    await questionSessionStore.addQuestion(session.id, {
      id: "q1",
      type: "text",
      text: "Q1",
      required: false,
      context: "",
      createdAt: Date.now(),
    });
    await questionSessionStore.addQuestion(session.id, {
      id: "q2",
      type: "text",
      text: "Q2",
      required: false,
      context: "",
      createdAt: Date.now(),
    });
    await questionSessionStore.addQuestion(session.id, {
      id: "q3",
      type: "text",
      text: "Q3",
      required: false,
      context: "",
      createdAt: Date.now(),
    });

    expect(session.currentIndex).toBe(0);

    const nav1 = await questionSessionStore.setCurrentIndex(session.id, 2);
    expect(nav1.currentIndex).toBe(2);

    const nav2 = await questionSessionStore.setCurrentIndex(session.id, 1);
    expect(nav2.currentIndex).toBe(1);

    // Clamps within bounds
    const navClamp = await questionSessionStore.setCurrentIndex(session.id, 99);
    expect(navClamp.currentIndex).toBe(2);
  });
});
