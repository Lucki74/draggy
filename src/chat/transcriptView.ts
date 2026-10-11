import { createContext, useContext } from "react";

/** How much of a turn's work the transcript shows. Normal folds work and hides finished
 * thinking, Thinking adds the thinking rows, Verbose opens everything. */
export type TranscriptView = "normal" | "thinking" | "verbose";

export const TRANSCRIPT_VIEWS: readonly TranscriptView[] = ["normal", "thinking", "verbose"];

/** The view after this one, as Ctrl+O steps through them. */
export const nextView = (view: TranscriptView): TranscriptView =>
  TRANSCRIPT_VIEWS[(TRANSCRIPT_VIEWS.indexOf(view) + 1) % TRANSCRIPT_VIEWS.length];

export const TranscriptViewContext = createContext<TranscriptView>("normal");

export const useTranscriptView = () => useContext(TranscriptViewContext);
