import { useEffect } from "react";
import { swallowed } from "../logger";

let signalled = false;

/** Tells the startup splash that this window has painted, so the swap shows no blank frame. Once per
 * page: StrictMode runs effects twice. */
export function ReadySignal() {
  useEffect(() => {
    if (signalled) return;
    signalled = true;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      void Promise.resolve(window.draggy?.startup?.ready?.()).catch(
        swallowed("startup", "the splash shows this window on its own after a timeout"),
      );
    };
    requestAnimationFrame(send);
    // WebKit on macOS and Linux runs no animation frames while the window is hidden.
    setTimeout(send, 100);
  }, []);
  return null;
}
