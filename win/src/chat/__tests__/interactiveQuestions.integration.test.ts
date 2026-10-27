import { beforeEach, describe, expect, it } from "vitest";
import { processQuestionsFromText } from "../questionParser";
import { questionSessionStore } from "../../store/questionSession";

describe("Interactive Questions Integration", () => {
  beforeEach(() => {
    questionSessionStore._clearAll();
  });

  it("handles full lifecycle: AI emits question -> store creates session -> user answers -> session completes", async () => {
    const aiResponse = `I need a bit more information before I can generate your project:
\`\`\`json
{
  "_draggy": {
    "type": "question-session",
    "sessionId": "sess_integration_1",
    "questions": [
      {
        "id": "q_lang",
        "type": "single",
        "text": "What language should we use?",
        "options": [
          { "id": "ts", "label": "TypeScript" },
          { "id": "js", "label": "JavaScript" }
        ],
        "required": true
      },
      {
        "id": "q_test",
        "type": "multi",
        "text": "Which testing libraries do you prefer?",
        "options": [
          { "id": "vitest", "label": "Vitest" },
          { "id": "playwright", "label": "Playwright" }
        ],
        "required": false
      }
    ],
    "required": true
  }
}
\`\`\`
Looking forward to your choices.`;

    const chatId = "chat_abc_123";

    // 1. Parser processes response
    const { result, session } = await processQuestionsFromText(aiResponse, chatId, "default");
    expect(result.hasQuestions).toBe(true);
    expect(session).toBeDefined();
    expect(session?.questions).toHaveLength(2);
    expect(session?.status).toBe("active");

    // 2. User answers Q1
    const sAfterQ1 = await questionSessionStore.submitAnswer(session!.id, {
      questionId: "q_lang",
      type: "single",
      value: "ts",
      submittedAt: Date.now(),
    });
    expect(sAfterQ1.answers).toHaveLength(1);
    expect(sAfterQ1.currentIndex).toBe(1);
    expect(sAfterQ1.status).toBe("active");

    // 3. User answers Q2
    const sAfterQ2 = await questionSessionStore.submitAnswer(session!.id, {
      questionId: "q_test",
      type: "multi",
      value: ["vitest", "playwright"],
      submittedAt: Date.now(),
    });
    expect(sAfterQ2.answers).toHaveLength(2);
    expect(sAfterQ2.status).toBe("completed");

    // 4. Verify session in store
    const allSessions = await questionSessionStore.getAllSessions(chatId);
    expect(allSessions).toHaveLength(1);
    expect(allSessions[0].status).toBe("completed");
    expect(allSessions[0].completedAt).toBeDefined();
  });

  it("handles multi-question navigation and timeout behavior", async () => {
    const aiResponse = `{
  "_draggy": {
    "type": "question-session",
    "questions": [
      { "id": "q1", "type": "text", "text": "Question 1" },
      { "id": "q2", "type": "text", "text": "Question 2" }
    ]
  }
}`;

    const chatId = "chat_timeout_test";
    const { session } = await processQuestionsFromText(aiResponse, chatId);
    expect(session).toBeDefined();

    // Navigate to question 2
    const sNav = await questionSessionStore.setCurrentIndex(session!.id, 1);
    expect(sNav.currentIndex).toBe(1);

    // Navigate back to question 1
    const sNavBack = await questionSessionStore.setCurrentIndex(session!.id, 0);
    expect(sNavBack.currentIndex).toBe(0);

    // Timeout / expire
    const sExpired = await questionSessionStore.expireSession(session!.id);
    expect(sExpired.status).toBe("expired");
  });

  it("clears question history for a specific chat", async () => {
    const chatId1 = "chat_1";
    const chatId2 = "chat_2";

    const s1 = await questionSessionStore.createSession(chatId1);
    const s2 = await questionSessionStore.createSession(chatId2);

    expect(await questionSessionStore.getAllSessions(chatId1)).toHaveLength(1);
    expect(await questionSessionStore.getAllSessions(chatId2)).toHaveLength(1);

    await questionSessionStore.clearSessions(chatId1);

    expect(await questionSessionStore.getAllSessions(chatId1)).toHaveLength(0);
    expect(await questionSessionStore.getAllSessions(chatId2)).toHaveLength(1);
  });
});
