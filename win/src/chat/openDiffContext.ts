import { createContext } from "react";

/** Opens the diff pane in the dock, optionally targeting a specific file. */
export const OpenDiffContext = createContext<((filePath?: string) => void) | null>(null);
