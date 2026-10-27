import type {
  QuestionOption,
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
export function validateQuestionSchema(q: any): string | null {
  if (!q || typeof q !== "object") {
    return "Question must be an object";
  }
  if (!q.id || typeof q.id !== "string" || !q.id.trim()) {
    return "Question missing required 'id'";
  }
  if (!q.text || typeof q.text !== "string" || !q.text.trim()) {
    return "Question missing required 'text'";
  }
  if (!q.type || !VALID_TYPES.has(q.type)) {
    return `Invalid question type: ${q.type}. Must be 'single', 'multi', or 'text'`;
  }
  if (q.type === "single" || q.type === "multi") {
    if (!Array.isArray(q.options) || q.options.length === 0) {
      return `Question of type '${q.type}' must contain at least one option`;
    }
    for (const opt of q.options) {
      if (!opt || typeof opt !== "object") {
        return "Option must be an object";
      }
      if (!opt.id || typeof opt.id !== "string" || !opt.id.trim()) {
        return "Option missing required 'id'";
      }
      if (!opt.label || typeof opt.label !== "string" || !opt.label.trim()) {
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
    let parsed: any;
    try {
      parsed = JSON.parse(candidate.jsonStr);
    } catch {
      parseError = "Invalid JSON in _draggy block";
      continue;
    }

    if (!parsed || !parsed._draggy) {
      continue;
    }

    const payload = parsed._draggy;
    if (payload.type === "question") {
      detectedType = "question";
      const q = payload.question;
      const err = validateQuestionSchema(q);
      if (err) {
        parseError = err;
        continue;
      }
      const userQ: UserQuestion = {
        id: q.id,
        type: q.type,
        text: q.text,
        options: q.options,
        minSelections: q.minSelections ?? 0,
        maxSelections: q.maxSelections ?? (q.options ? q.options.length : undefined),
        required: q.required ?? true,
        context: q.context ?? "",
        createdAt: q.createdAt ?? Date.now(),
        expiresAt: q.expiresAt,
      };
      questions.push(userQ);
      cleanText = cleanText.replace(candidate.rawMatch, "").trim();
    } else if (payload.type === "question-session") {
      detectedType = "question-session";
      sessionId = payload.sessionId;
      sessionRequired = payload.required;

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
        questions.push({
          id: q.id,
          type: q.type,
          text: q.text,
          options: q.options,
          minSelections: q.minSelections ?? 0,
          maxSelections: q.maxSelections ?? (q.options ? q.options.length : undefined),
          required: q.required ?? (sessionRequired ?? true),
          context: q.context ?? payload.context ?? "",
          createdAt: q.createdAt ?? Date.now(),
          expiresAt: q.expiresAt ?? payload.expiresAt,
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
    } else {
      session = await questionSessionStore.createSession(chatId, workspaceId, {
        parsedSessionId: result.sessionId,
      });
    }
  } else {
    // Check if there is already an active session for this chat
    const active = await questionSessionStore.getActiveSession(chatId);
    if (active) {
      session = active;
    } else {
      session = await questionSessionStore.createSession(chatId, workspaceId);
    }
  }

  // Add questions to the session
  for (const q of result.questions) {
    await questionSessionStore.addQuestion(session.id, q);
  }

  const updatedSession = await questionSessionStore.getSession(session.id);
  return { result, session: updatedSession ?? session };
}
