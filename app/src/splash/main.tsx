import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geologica/full.css";
import "../index.css";
import { applyAccent } from "../app/accent";
import { resolveTheme } from "../app/settings";
import type { AppSettings } from "../types";
import SplashScreen from "./SplashScreen";

const boot = window.__DRAGGY_SPLASH__;
const theme = (["light", "dark", "system"].includes(boot?.theme ?? "") ? boot?.theme : "system") as AppSettings["theme"];
const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
const dark = resolveTheme(theme, prefersDark) === "dark";
document.body.classList.toggle("dark", dark);
applyAccent(boot?.accent ?? undefined, dark);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SplashScreen language={boot?.language || "en"} />
  </StrictMode>,
);
