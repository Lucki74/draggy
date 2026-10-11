# Draggy design system

Specification for Draggy's interface: neutral planes, clear typography, Phosphor icons, and an amber accent for active work.

## 1. Principles

1. Content carries the contrast; frames and chrome stay quiet. Assistant replies appear as plain text at regular weight. Frames and controls sit one tone lower.
2. Words take priority over icons for controls that alter behavior. Icon-only buttons are reserved for universal actions and include accessible labels.
3. One way to separate elements: a 1px rule or a single tone step. Shadows are used only for floating overlays like menus, popovers, and dialogs.
4. Color indicates active work. Ink and cool greys handle structure and navigation. The ember accent appears only while a model or task is executing.
5. Shortcuts align with Claude Code conventions where actions match.
6. Low overhead by default. Animations pause when backgrounded or hidden.

## 2. Color tokens

Values are defined in OKLCH and checked for WCAG 2 contrast.

| Token | Light | Dark | Contrast (L / D) | Use |
|---|---|---|---|---|
| `--surface-canvas` | `#f5f7f9` | `#0e1012` | | Window, sidebar, transcript background |
| `--surface-base` | `#ffffff` | `#15171a` | | Composer, cards, panes |
| `--surface-raised` | `#eaedf1` | `#1f2225` | | Hover, selected row, user message |
| `--surface-tint` | `rgba(26,30,36,.05)` | `rgba(231,234,237,.06)` | | Chips, inline code, quiet fills |
| `--rule` | `rgba(26,30,36,.10)` | `rgba(231,234,237,.10)` | 1.22 / 1.28 on base | Hairlines; decorative |
| `--rule-strong` | `rgba(26,30,36,.22)` | `rgba(231,234,237,.22)` | 1.58 / 1.87 on base | Focused pane edge, scrollbar thumb |
| `--rule-control` | `rgba(26,30,36,.49)` | `rgba(231,234,237,.37)` | 3.04 / 3.07 on base | Edges of text fields, checkboxes, switches |
| `--text-primary` | `#1a1e24` | `#e7eaed` | 15.58 / 15.79 | Body text |
| `--text-secondary` | `#565b62` | `#a6abb2` | 6.37 / 8.25 | Labels, metadata, placeholders |
| `--text-tertiary` | `#82878c` | `#767b81` | 3.38 / 4.47 | Disabled text and decoration only |
| `--action-bg` | `#1a1e24` | `#e7eaed` | | Primary pill button |
| `--action-fg` | `#ffffff` | `#0e1012` | 16.73 / 15.79 on action-bg | Text on primary pill |
| `--focus` | `var(--text-primary)` | `var(--text-primary)` | 15.58 / 15.79 | Focus ring, selected chip edge |
| `--ok` | `#1a763f` | `#78d694` | 5.27 / 10.75 | Success, engine ready |
| `--warn` | `#8d6310` | `#e5d183` | 4.98 / 12.51 | Warnings, approval needed |
| `--danger` | `#bd1f3d` | `#fa7f8e` | 5.71 / 7.71 | Errors, destructive actions, Deny |
| `--ember-1` | `#f9ad26` | `#ffeeb5` | 1.77 / 16.48 | Hot end: gradient stops and particle cores |
| `--ember-2` | `#e75c00` | `#fd962c` | 3.30 / 8.69 | The ember: spark, caret, fuse head |
| `--ember-3` | `#cd3000` | `#f15d1f` | 4.87 / 5.74 | Cooling end of the ramp |
| `--ember-glow` | `rgba(231,92,0,.16)` | `rgba(253,150,44,.22)` | | Hearth glow, spark halo in dark |

### Rules for color
- Neutrals sit at OKLCH hue 255 with chroma <= 0.013.
- Focus rings, links, and text selection use `--text-primary`.
- Links use a 1px underline in `--rule-control` that darkens on hover.
- Warnings use `--warn` (ochre) accompanied by an icon or text label. Danger sits at hue 18 (crimson) and `--ember-3` at hue 36 (vermilion) to prevent confusion.
- Tokens prefixed with `--ember-` are restricted to `src/ui/signature/`.

## 3. Ember indicators

Draggy remains monochrome when idle. When work occurs, warm ember elements communicate active state:

- Spark (`Spark.tsx`): 6px dot flickering on dual keyframe tracks (1.3s opacity, 1.9s scale). Shows on working sessions, the engine status row, the thinking indicator, and active tool steps.
- Ember caret (`EmberCaret.tsx`): 2px bar, one line tall, vertical gradient at the streaming text edge. Streamed text arrives a word at a time with a short fade-in, paced by how much is waiting (`src/chat/streamReveal.ts`).
- Fuse (`Fuse.tsx`): 2px line along the composer top edge. An indeterminate loop runs during execution; a determinate bar tracks model loading.
- Embers (`Embers.tsx`): Canvas 2D particle simulation for the Talk view and startup screen.
- Hearth glow (`HearthGlow.tsx`): 2px bottom line with an upward 64px gradient while the microphone is listening.

## 4. Typography

### Typefaces
- UI: Geologica (`@fontsource-variable/geologica`), OFL-1.1. Variable weight 100-900, slant 0 to -12, sharpness `SHRP` 0-100.
  - UI text runs at `SHRP: 0`.
  - Display text (greetings, onboarding hero) raises sharpness through `--display-sharpness`.
  - Emphasis uses oblique slant on `slnt` without synthetic browser slant.
- Code: JetBrains Mono (`@fontsource-variable/jetbrains-mono`), OFL-1.1. Ligatures disabled (`font-variant-ligatures: none`).
- Chinese: System font stack under `:lang(zh)`: `"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC"`.

### Type scale (px / line-height)
- 12 [16]: Caption, token stats
- 13 [18]: Label, dense UI, work step rows
- 14 [20]: Default UI
- 15 [24]: Chat body text
- 18 [26]: Pane titles
- 22 [28]: Page titles
- 32 [40]: Home greeting
- 44 [52]: Onboarding hero

### Weights and casing
- Weights: 400 body, 450 UI labels, 500 buttons and emphasis, 600 headings. Markdown bold renders at 600.
- Sentence case everywhere. Uppercase is prohibited in UI text.
- Tabular figures (`font-variant-numeric: tabular-nums`) for stats, counts, and timers.

## 5. Icons

- Set: Phosphor (`@phosphor-icons/core`), MIT.
- Delivery: SVG paths compiled into `src/ui/icons/glyphs.generated.ts` via `scripts/build-icons.cjs`.
- Component: `<Icon name size? filled? mirrored? label? />`.
- Weights: Regular at 16px and 20px; Light at 24px and up; Fill for active toggles.

## 6. Shape, space, and elevation

- Radii:
  - `--r-xs`: 6px (inline code, kbd)
  - `--r-sm`: 10px (inputs, small cards, list rows)
  - `--r-md`: 16px (cards, panes, code blocks)
  - `--r-lg`: 24px (composer, dialogs)
  - `--r-pill`: 9999px (buttons, chips, segmented controls)
- Grid: 4px base, 8px rhythm. Sidebar row 32px, list row 36px, toolbar 44px, title bar 40px.
- Borders: 1px hairline (`--rule` or `--rule-control`).
- Elevation: Level 0 (flat canvas), Level 1 (menus, popovers, dropdowns), Level 2 (dialogs with scrim).
- Scrollbars: 8px overlay thumb in `--rule-strong`, without a track background.

## 7. Motion

- Durations: 120ms (hover and press), 180ms (menus and disclosures), 240ms (panes and page switches).
- Easings: `cubic-bezier(.2,0,0,1)` in, `cubic-bezier(.3,0,1,1)` out.
- `prefers-reduced-motion`: Embers and glow hold static frames; spark and caret hold steady brightness; panes cut without sliding transitions; the word fade-in is skipped.
