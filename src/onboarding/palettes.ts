/** Both themes' colours at once, for the Appearance cards, which show each theme whatever the page
 * is in. Copied from src/index.css; a test fails if the two drift. */

export interface Palette {
  base: string;
  panel: string;
  input: string;
  inverted: string;
  border: string;
  muted: string;
}

export const THEME_PALETTES: Record<"light" | "dark", Palette> = {
  light: { base: "#e5e5e5", panel: "#f5f5f5", input: "#ffffff", inverted: "#2b2b2b", border: "#a3a3a3", muted: "#5f5f5f" },
  dark: { base: "#121212", panel: "#1e1e1e", input: "#121212", inverted: "#2d2d2d", border: "#333333", muted: "#888888" },
};
