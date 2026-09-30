/** The window colour before the page paints, read from the saved theme. A hardcoded dark one
 * flashed every light-theme launch. */

/** `--bg-base` in src/index.css, for each theme. */
const BACKGROUNDS = { light: "#e5e5e5", dark: "#121212" };

const THEMES = ["light", "dark", "system"];

/** The theme in the saved settings JSON. No settings means a new install, which follows the system. */
function themeSetting(rawSettings) {
  if (typeof rawSettings !== "string" || !rawSettings) return "system";
  try {
    const theme = JSON.parse(rawSettings)?.theme;
    return THEMES.includes(theme) ? theme : "system";
  } catch {
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

module.exports = { BACKGROUNDS, themeSetting, resolvedTheme, backgroundFor };
