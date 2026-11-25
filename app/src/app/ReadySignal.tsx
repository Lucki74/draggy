import { useEffect } from "react";
import { swallowed } from "../logger";

let signalled = false;

/** Tells the startup splash that this window has painted, so the swap shows no blank frame. Once per
 * page: StrictMode runs effects twice. */
export function ReadySignal() {
  useEffect(() => {
    if (signalled) return;
    signalled = true;
    requestAnimationFrame(() => {
      void Promise.resolve(window.draggy?.startup?.ready?.()).catch(
        swallowed("startup", "the splash shows this window on its own after a timeout"),
      );
    });
  }, []);
  return null;
}
