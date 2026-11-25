import { createContext } from "react";

/** True inside a rail: the rail draws each step's node, so a step leaves out its own mark. */
export const RailContext = createContext(false);

/** How far a line is indented, so a wrapped line can hang past its own indent. */
export const leadingSpaces = (text: string) => text.length - text.trimStart().length;
