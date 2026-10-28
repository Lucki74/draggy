import type {
  QuestionSession,
  QuestionType,
  UserQuestion,
} from "./questionTypes";
import { questionSessionStore } from "../store/questionSession";

export interface ParsedQuestionResult {
  hasQuestions: boolean;
  type?: "question" | "question-session";
  sessionId?: string;
  questions: UserQuestion[];
  cleanText: string;
  required?: boolean;
  error?: string;
}

const VALID_TYPES: Set<QuestionType> = new Set(["single", "multi", "text"]);

/**
 * Validates a single UserQuestion object schema.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateQuestionSchema(q: unknown): string | null {
  if (!q || typeof q !== "object") {
    return "Question must be an object";
  }
  const obj = q as Record<string, unknown>;
  if (!obj.id || typeof obj.id !== "string" || !obj.id.trim()) {
    return "Question missing required 'id'";
  }
  if (!obj.text || typeof obj.text !== "string" || !obj.text.trim()) {
    return "Question missing required 'text'";
  }
  if (!obj.type || typeof obj.type !== "string" || !VALID_TYPES.has(obj.type as QuestionType)) {
    return `Invalid question type: ${obj.type}. Must be 'single', 'multi', or 'text'`;
  }
  if (obj.type === "single" || obj.type === "multi") {
    if (!Array.isArray(obj.options) || obj.options.length === 0) {
      return `Question of type '${obj.type}' must contain at least one option`;
    }
    for (const opt of obj.options) {
      if (!opt || typeof opt !== "object") {
        return "Option must be an object";
      }
      const optObj = opt as Record<string, unknown>;
      if (!optObj.id || typeof optObj.id !== "string" || !optObj.id.trim()) {
        return "Option missing required 'id'";
      }
      if (!optObj.label || typeof optObj.label !== "string" || !optObj.label.trim()) {
        return "Option missing required 'label'";
      }
    }
  }
  return null;
}

/**
 * Extracts JSON blocks containing `_draggy` from text and validates questions.
 */
export function parseQuestions(text: string): ParsedQuestionResult {
  if (!text || !text.includes('"_draggy"')) {
    return { hasQuestions: false, questions: [], cleanText: text };
  }

  // Regex to match markdown code blocks ```json ... ``` or ``` ... ``` or raw {...}
  // Let's locate the _draggy pattern
  let cleanText = text;
  const questions: UserQuestion[] = [];
  let sessionId: string | undefined;
  let sessionRequired: boolean | undefined;
  let detectedType: "question" | "question-session" | undefined;
  let parseError: string | undefined;

  // 1. Try finding fenced code blocks containing _draggy
  const codeBlockRegex = /```(?:json)?\s*(\{\s*"_draggy"[\s\S]*?\})\s*```/g;
  let match: RegExpExecArray | null;

  const jsonCandidates: { rawMatch: string; jsonStr: string }[] = [];

  while ((match = codeBlockRegex.exec(text)) !== null) {
    jsonCandidates.push({ rawMatch: match[0], jsonStr: match[1] });
  }

  // 2. If no code blocks matched, try finding raw JSON blocks with balanced braces around _draggy
  if (jsonCandidates.length === 0) {
    const draggyIdx = text.indexOf('"_draggy"');
    if (draggyIdx !== -1) {
      // Find the start brace { before _draggy
      const openBrace = text.lastIndexOf("{", draggyIdx);
      if (openBrace !== -1) {
        // Find matching close brace
        let depth = 0;
        let inString = false;
        let escape = false;
        let closeBrace = -1;

        for (let i = openBrace; i < text.length; i++) {
          const char = text[i];
          if (inString) {
            if (escape) {
              escape = false;
            } else if (char === "\\") {
              escape = true;
            } else if (char === '"') {
              inString = false;
            }
          } else {
            if (char === '"') {
              inString = true;
            } else if (char === "{") {
              depth++;
            } else if (char === "}") {
              depth--;
              if (depth === 0) {
                closeBrace = i;
                break;
              }
            }
          }
        }

        if (closeBrace !== -1) {
          const rawMatch = text.slice(openBrace, closeBrace + 1);
          jsonCandidates.push({ rawMatch, jsonStr: rawMatch });
        } else {
          parseError = "Malformed JSON block for _draggy";
        }
      }
    }
  }

  for (const candidate of jsonCandidates) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(candidate.jsonStr) as Record<string, unknown>;
    } catch {
      parseError = "Invalid JSON in _draggy block";
      continue;
    }

    if (!parsed || !parsed._draggy || typeof parsed._draggy !== "object") {
      continue;
    }

    const payload = parsed._draggy as Record<string, unknown>;
    if (payload.type === "question") {
      detectedType = "question";
      const q = payload.question as Record<string, unknown>;
      const err = validateQuestionSchema(q);
      if (err) {
        parseError = err;
        continue;
      }
      const userQ: UserQuestion = {
        id: String(q.id),
        type: q.type as QuestionType,
        text: String(q.text),
        options: q.options as UserQuestion["options"],
        minSelections: typeof q.minSelections === "number" ? q.minSelections : 0,
        maxSelections:
          typeof q.maxSelections === "number"
            ? q.maxSelections
            : Array.isArray(q.options)
              ? q.options.length
              : undefined,
        required: typeof q.required === "boolean" ? q.required : true,
        context: typeof q.context === "string" ? q.context : "",
        createdAt: typeof q.createdAt === "number" ? q.createdAt : Date.now(),
        expiresAt: typeof q.expiresAt === "number" ? q.expiresAt : undefined,
      };
      questions.push(userQ);
      cleanText = cleanText.replace(candidate.rawMatch, "").trim();
    } else if (payload.type === "question-session") {
      detectedType = "question-session";
      sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
      sessionRequired = typeof payload.required === "boolean" ? payload.required : undefined;

      if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
        parseError = "question-session must contain non-empty questions array";
        continue;
      }

      let allValid = true;
      for (const q of payload.questions) {
        const err = validateQuestionSchema(q);
        if (err) {
          parseError = err;
          allValid = false;
          break;
        }
        const qObj = q as Record<string, unknown>;
        questions.push({
          id: String(qObj.id),
          type: qObj.type as QuestionType,
          text: String(qObj.text),
          options: qObj.options as UserQuestion["options"],
          minSelections: typeof qObj.minSelections === "number" ? qObj.minSelections : 0,
          maxSelections:
            typeof qObj.maxSelections === "number"
              ? qObj.maxSelections
              : Array.isArray(qObj.options)
                ? qObj.options.length
                : undefined,
          required: typeof qObj.required === "boolean" ? qObj.required : (sessionRequired ?? true),
          context:
            typeof qObj.context === "string"
              ? qObj.context
              : typeof payload.context === "string"
                ? payload.context
                : "",
          createdAt: typeof qObj.createdAt === "number" ? qObj.createdAt : Date.now(),
          expiresAt:
            typeof qObj.expiresAt === "number"
              ? qObj.expiresAt
              : typeof payload.expiresAt === "number"
                ? payload.expiresAt
                : undefined,
        });
      }

      if (allValid) {
        cleanText = cleanText.replace(candidate.rawMatch, "").trim();
      }
    } else {
      parseError = `Unknown _draggy type: ${payload.type}`;
    }
  }

  return {
    hasQuestions: questions.length > 0,
    type: detectedType,
    sessionId,
    questions,
    cleanText,
    required: sessionRequired,
    error: parseError,
  };
}

/**
 * Checks if a response contains question blocks and emits them to the QuestionSession store.
 */
export async function processQuestionsFromText(
  text: string,
  chatId: string,
  workspaceId: string = "default",
  messageId?: string,
): Promise<{ result: ParsedQuestionResult; session?: QuestionSession }> {
  const result = parseQuestions(text);
  if (!result.hasQuestions) {
    return { result };
  }

  // Create or retrieve session in questionSessionStore
  let session: QuestionSession;
  if (result.sessionId) {
    const existing = await questionSessionStore.getSession(result.sessionId);
    if (existing) {
      session = existing;
      if (messageId && !session.messageId) {
        await questionSessionStore.updateSession(session.id, { messageId });
      }
    } else {
      session = await questionSessionStore.createSession(
        chatId,
        workspaceId,
        { parsedSessionId: result.sessionId, messageId },
        messageId,
      );
    }
  } else {
    // Check if there is already an active session for this chat
    const active = await questionSessionStore.getActiveSession(chatId);
    if (active) {
      session = active;
      if (messageId && !session.messageId) {
        await questionSessionStore.updateSession(session.id, { messageId });
      }
    } else {
      session = await questionSessionStore.createSession(chatId, workspaceId, { messageId }, messageId);
    }
  }

  // Add questions to the session
  for (const q of result.questions) {
    await questionSessionStore.addQuestion(session.id, q);
  }

  const updatedSession = await questionSessionStore.getSession(session.id);
  return { result, session: updatedSession ?? session };
}
