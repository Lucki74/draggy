import { createContext } from "react";

/** True while the message's last block is still being written; diagrams wait until it completes. */
export const MermaidStreamingContext = createContext(false);
