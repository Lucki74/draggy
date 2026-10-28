import { createContext, useContext } from "react";
import type { QuestionSession } from "./questionTypes";

export interface QuestionSessionContextValue {
  sessions: QuestionSession[];
  activeSession: QuestionSession | null;
  onAnswer?: (questionId: string, value: string | string[]) => void;
  onSkip?: (questionId: string) => void;
  onNavigate?: (index: number) => void;
  onComplete?: () => void;
  t: (key: string) => string;
}

export const QuestionSessionContext = createContext<QuestionSessionContextValue | null>(null);

export const useQuestionSessionContext = () => useContext(QuestionSessionContext);
