import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geologica/full.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App.tsx";
import BrowserBar from "./BrowserBar.tsx";
import { translations } from "./translations";
import { SETTINGS_KEY } from "./storage";
import { safeJsonParse } from "./utils";
import { applyAccent } from "./app/accent";
import { resolveTheme } from "./app/settings";
import type { AppSettings } from "./types";
import { installGlobalHandlers } from "./logger";

installGlobalHandlers();

/** The browser toolbar is its own window, not the app. Rendering it through `App` would start the
 * session store and updater for three buttons. */
const isBrowserBar = window.location.search.includes("browserbar=true");
const isGallery = import.meta.env.DEV && window.location.search.includes("gallery=true");
const ComponentGallery = isGallery
  ? lazy(() => import("./ui/gallery/ComponentGallery"))
  : null;

function savedSettings(): Partial<AppSettings> {
  const saved = localStorage.getItem(SETTINGS_KEY);
  return (saved ? safeJsonParse<Partial<AppSettings>>(saved) : null) ?? {};
}

const settings = savedSettings();
const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
const startDark = resolveTheme(settings.theme ?? "system", prefersDark) === "dark";
if (startDark) document.body.classList.add("dark");
applyAccent(settings.accent, startDark);

function browserBarT(language: string) {
  return (key: string) => translations[language]?.[key] || translations.en[key] || key;
}

if (isBrowserBar) {
  // The toolbar never renders `App`, which is what normally applies these.
  document.body.classList.add("browser-bar");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isBrowserBar ? (
      <BrowserBar t={browserBarT(savedSettings().language || "en")} />
    ) : isGallery && ComponentGallery ? (
      <Suspense fallback={null}>
        <ComponentGallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
