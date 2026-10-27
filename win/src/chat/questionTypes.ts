export type QuestionType = "single" | "multi" | "text";

export interface QuestionOption {
  id: string; // unique within the question
  label: string; // displayed option text
  description?: string; // optional subtitle
}

export interface UserQuestion {
  id: string; // unique across all questions
  type: QuestionType;
  text: string; // the question prompt
  options?: QuestionOption[]; // for single/multi types only
  minSelections?: number; // for multi: minimum selections required (default 0)
  maxSelections?: number; // for multi: maximum selections required (default options.length)
  required: boolean; // whether user must answer before continuing
  context: string; // why the AI is asking this (metadata)
  createdAt: number; // timestamp
  expiresAt?: number; // optional timeout
}

export interface UserAnswer {
  questionId: string;
  type: QuestionType;
  value: string | string[]; // single string for single/text, array of option ids for multi
  submittedAt: number;
}

export interface QuestionSession {
  id: string;
  chatId: string;
  workspaceId: string;
  status: "active" | "completed" | "expired" | "skipped";
  questions: UserQuestion[];
  answers: UserAnswer[];
  currentIndex: number; // which question the user is on
  startedAt: number;
  completedAt?: number;
  metadata?: Record<string, any>; // arbitrary context from the AI
}
