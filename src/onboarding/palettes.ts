/** Both themes' colours at once, for the Appearance cards, which show each theme whatever the page
 * is in. Copied from src/index.css; a test fails if the two drift. */

export interface Palette {
  canvas: string;
  base: string;
  raised: string;
  rule: string;
  ruleControl: string;
  primary: string;
  tertiary: string;
}

export const THEME_PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    canvas: "#f5f7f9",
    base: "#ffffff",
    raised: "#eaedf1",
    rule: "rgba(26, 30, 36, 0.10)",
    ruleControl: "rgba(26, 30, 36, 0.49)",
    primary: "#1a1e24",
    tertiary: "#82878c",
  },
  dark: {
    canvas: "#0e1012",
    base: "#15171a",
    raised: "#1f2225",
    rule: "rgba(231, 234, 237, 0.10)",
    ruleControl: "rgba(231, 234, 237, 0.37)",
    primary: "#e7eaed",
    tertiary: "#767b81",
  },
};
