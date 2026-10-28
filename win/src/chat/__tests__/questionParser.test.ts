import { describe, expect, it } from "vitest";
import { parseQuestions, validateQuestionSchema } from "../questionParser";

describe("questionParser", () => {
  it("parses single question from JSON block", () => {
    const raw = `Here is a question for you:
\`\`\`json
{
  "_draggy": {
    "type": "question",
    "question": {
      "id": "q_lang",
      "type": "single",
      "text": "What language do you want the response in?",
      "options": [
        { "id": "en", "label": "English", "description": "Default" },
        { "id": "fr", "label": "Français", "description": "French" },
        { "id": "es", "label": "Español", "description": "Spanish" }
      ],
      "required": true,
      "context": "language preference"
    }
  }
}
\`\`\`
Let me know what you prefer!`;

    const result = parseQuestions(raw);
    expect(result.hasQuestions).toBe(true);
    expect(result.type).toBe("question");
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].id).toBe("q_lang");
    expect(result.questions[0].type).toBe("single");
    expect(result.questions[0].text).toBe("What language do you want the response in?");
    expect(result.questions[0].options).toHaveLength(3);
    expect(result.questions[0].required).toBe(true);
    expect(result.cleanText).not.toContain("_draggy");
    expect(result.cleanText).toContain("Here is a question for you:");
    expect(result.cleanText).toContain("Let me know what you prefer!");
  });

  it("parses multi-question session", () => {
    const raw = `{
  "_draggy": {
    "type": "question-session",
    "sessionId": "sess_xyz789",
    "questions": [
      {
        "id": "q1",
        "type": "single",
        "text": "What is your role?",
        "options": [{ "id": "dev", "label": "Developer" }]
      },
      {
        "id": "q2",
        "type": "multi",
        "text": "Which features do you need?",
        "options": [
          { "id": "f1", "label": "Feature 1" },
          { "id": "f2", "label": "Feature 2" }
        ],
        "minSelections": 1
      },
      {
        "id": "q3",
        "type": "text",
        "text": "Any additional details?"
      }
    ],
    "required": true
  }
}`;

    const result = parseQuestions(raw);
    expect(result.hasQuestions).toBe(true);
    expect(result.type).toBe("question-session");
    expect(result.sessionId).toBe("sess_xyz789");
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0].type).toBe("single");
    expect(result.questions[1].type).toBe("multi");
    expect(result.questions[1].minSelections).toBe(1);
    expect(result.questions[2].type).toBe("text");
    expect(result.cleanText).toBe("");
  });

  it("handles invalid JSON (malformed block) gracefully without throwing", () => {
    const raw = `Some text before
\`\`\`json
{
  "_draggy": {
    "type": "question",
    "question": { malformed JSON here ...
}
\`\`\`
Some text after`;

    const result = parseQuestions(raw);
    expect(result.hasQuestions).toBe(false);
    expect(result.questions).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it("validates missing required fields", () => {
    // Missing id
    expect(validateQuestionSchema({ type: "text", text: "Hello" })).toContain("missing required 'id'");

    // Missing text
    expect(validateQuestionSchema({ id: "q1", type: "text" })).toContain("missing required 'text'");

    // Missing type
    expect(validateQuestionSchema({ id: "q1", text: "Hello" })).toContain("Invalid question type");
  });

  it("validates question types correctly (single vs multi vs text)", () => {
    // single without options -> error
    expect(
      validateQuestionSchema({
        id: "q1",
        type: "single",
        text: "Select one",
      }),
    ).toContain("must contain at least one option");

    // multi without options -> error
    expect(
      validateQuestionSchema({
        id: "q2",
        type: "multi",
        text: "Select any",
      }),
    ).toContain("must contain at least one option");

    // text without options -> valid
    expect(
      validateQuestionSchema({
        id: "q3",
        type: "text",
        text: "Enter details",
      }),
    ).toBeNull();

    // unknown type -> error
    expect(
      validateQuestionSchema({
        id: "q4",
        type: "dropdown",
        text: "Choose",
      }),
    ).toContain("Invalid question type");

    // option missing id or label
    expect(
      validateQuestionSchema({
        id: "q5",
        type: "single",
        text: "Choose",
        options: [{ id: "1" }],
      }),
    ).toContain("missing required 'label'");
  });
});
