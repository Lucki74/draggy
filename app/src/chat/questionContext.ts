import { createContext } from "react";
import type { UserReply } from "../types";

/** Sends the user's reply to a question the model asked, or null to dismiss it. */
export const AnswerQuestionContext = createContext<((id: string, reply: UserReply | null) => void) | null>(null);
