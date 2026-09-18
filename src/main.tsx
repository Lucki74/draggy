import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App.tsx";
import BrowserBar from "./BrowserBar.tsx";
import { SETTINGS_KEY } from "./storage";
import { safeJsonParse } from "./utils";
import type { AppSettings } from "./types";

/** The browser toolbar is its own window, not the app. Rendering it through `App` would start the
 * session store and updater for three buttons. */
const isBrowserBar = window.location.search.includes("browserbar=true");

function savedSettings(): Partial<AppSettings> {
  const saved = localStorage.getItem(SETTINGS_KEY);
  return (saved ? safeJsonParse<Partial<AppSettings>>(saved) : null) ?? {};
}

const settings = savedSettings();
if ((settings.theme ?? "dark") === "dark") document.body.classList.add("dark");

if (isBrowserBar) {
  // The toolbar never renders `App`, which is what normally applies these.
  document.body.classList.add("browser-bar");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isBrowserBar ? (
      <BrowserBar language={savedSettings().language || "en"} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
