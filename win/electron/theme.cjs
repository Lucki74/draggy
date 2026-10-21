const { log } = require("./logger.cjs");

/** The window colour before the page paints, read from the saved theme. A hardcoded dark one
 * flashed every light-theme launch. */

/** `--surface-canvas` in src/index.css, for each theme. */
const BACKGROUNDS = { light: "#f5f7f9", dark: "#0e1012" };
const FOREGROUNDS = { light: "#1a1e24", dark: "#e7eaed" };

const THEMES = ["light", "dark", "system"];

/** The accents in src/app/accent.ts, for native pieces that cannot read the page's CSS. */
const ACCENT_COLORS = {
  vermilion: "#d55e00",
  blue: "#0072b2",
  orange: "#e69f00",
  green: "#009e73",
  pink: "#cc79a7",
  sky: "#56b4e9",
  yellow: "#f0e442",
};

/** The accent colour in the saved settings JSON, vermilion when none is saved. */
function accentColor(rawSettings) {
  if (typeof rawSettings !== "string" || !rawSettings) return ACCENT_COLORS.vermilion;
  try {
    const accent = JSON.parse(rawSettings)?.accent;
    return Object.hasOwn(ACCENT_COLORS, accent) ? ACCENT_COLORS[accent] : ACCENT_COLORS.vermilion;
  } catch (error) {
    log.warn("settings", "saved accent unreadable, using vermilion", { error: error?.name ?? null });
    return ACCENT_COLORS.vermilion;
  }
}

/** The theme in the saved settings JSON. No settings means a new install, which follows the system. */
function themeSetting(rawSettings) {
  if (typeof rawSettings !== "string" || !rawSettings) return "system";
  try {
    const theme = JSON.parse(rawSettings)?.theme;
    return THEMES.includes(theme) ? theme : "system";
  } catch (error) {
    log.warn("settings", "saved theme unreadable, using system", { error: error?.name ?? null });
    return "system";
  }
}

function resolvedTheme(setting, systemIsDark) {
  if (setting === "system") return systemIsDark ? "dark" : "light";
  return setting === "light" ? "light" : "dark";
}

function backgroundFor(setting, systemIsDark) {
  return BACKGROUNDS[resolvedTheme(setting, systemIsDark)];
}

let lastTheme = null;

function overlayColors(setting, systemIsDark) {
  const isDark = resolvedTheme(setting, systemIsDark) === "dark";
  const theme = isDark ? "dark" : "light";
  log.debug("window", "overlay colours resolved", { theme });
  if (theme !== lastTheme) {
    lastTheme = theme;
    log.info("window", "theme changed", { theme, setting });
  }
  return {
    color: isDark ? BACKGROUNDS.dark : BACKGROUNDS.light,
    symbolColor: isDark ? FOREGROUNDS.dark : FOREGROUNDS.light,
    height: 40,
  };
}

module.exports = { ACCENT_COLORS, accentColor, BACKGROUNDS, FOREGROUNDS, themeSetting, resolvedTheme, backgroundFor, overlayColors };

