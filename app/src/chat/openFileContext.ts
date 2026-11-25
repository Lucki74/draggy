import { createContext } from "react";

/** Opens a project file in the canvas. Absent outside a project, where files open in their own app. */
export const OpenFileContext = createContext<((path: string) => void) | null>(null);

/** The open project folder, so steps can show paths from it. Absent outside a project. */
export const ProjectRootContext = createContext<string | null>(null);
