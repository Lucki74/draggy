---
name: dark-mode-theming
description: Adds a light and dark theme to a web UI with system preference detection, a saved user override and no flash of the wrong theme on load. Use when the user asks to add dark mode, support theme switching, or fix dark mode flashing white.
---

# Dark mode theming

## Goal

The page matches the user's chosen theme, falls back to the system preference and never flashes the wrong colors while loading. A good result changes colors through variables in one place and leaves components alone.

## When to use

- The user wants dark mode or a theme toggle added.
- An existing dark mode flashes, has unreadable parts or ignores the system setting.
- For building the variable set itself, use `use_skill` with `design-tokens`.
- For contrast and readability checks, use `use_skill` with `accessibility`.
- Dark mode exists but some pages or components were missed.
- The user wants a theme per brand or per user beyond light and dark.

## Steps

1. Find how colors are defined with `search_files`: custom properties, a Tailwind config, a theme object in JS or hardcoded hex values. Read the main style entry with `read_file`.
2. If colors are hardcoded, move them behind semantic variables first. A theme cannot be added cleanly over raw hex values.
3. Define the dark palette as a second set of values for the same variable names. Do not invert the light palette mechanically. Re-pick surfaces, borders and text so contrast holds, and check text against backgrounds.
4. Choose the switching mechanism: `prefers-color-scheme` media query for system default, plus an attribute on the root element (such as `data-theme`) for the user override.
5. Set `color-scheme: light dark` on the root so form controls, scrollbars and default backgrounds follow the theme.
6. Prevent the flash: put a small inline script in the document head that reads the saved choice and sets the root attribute before first paint. Do not wait for the framework to mount.
7. Add the toggle with three states (system, light, dark), save the choice in local storage inside a try block, and update the control when the system preference changes.
8. Check images, SVG, charts, embedded code blocks and shadows. Verify with `browser_screenshot` in both themes on the main screens, using the browser's emulated color scheme.
9. Check media that needs adaptation: logos, screenshots in docs, maps, charts and code highlighting themes. List each and its dark variant status.
10. Verify the browser UI hint: set the `theme-color` meta tag for both schemes with media attributes so the address bar matches.

## Gotchas

- Setting the theme in a mounted component means the first paint uses the default, so dark users see a white flash. The inline head script is the fix.
- Pure black backgrounds with pure white text cause halation for many readers. Use off-black surfaces and slightly dimmed text, and test them.
- Images and logos with baked-in white backgrounds or dark text break in dark mode. Provide variants or use transparent assets.
- Shadows disappear on dark surfaces. Use borders or lighter surface steps to show elevation.
- Local storage can throw in private windows or when blocked. Wrap reads and writes and default to the system preference.
- Third-party embeds such as maps, comment widgets and payment frames have their own theme and often need an explicit option.
- System preference changes while the page is open. Listen to the media query change event or the page will disagree with the OS until reload.
- Semi-transparent overlays computed for a light background look muddy in dark. Re-tune opacity per theme.
- Print stylesheets inherit the dark theme and waste ink. Force the light palette in print.

## Output

- The variable definitions for both themes and the root switching logic.
- The head script and the toggle component.
- A checklist of screens verified in each theme and any asset still needing a dark variant.
- Mention any component you did not retheme so it is not mistaken for a pass.
