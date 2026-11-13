---
name: frontend-design
description: "Designs and builds distinctive web interfaces in HTML, Tailwind, React, Vue, Svelte or Next.js: commits to one aesthetic direction, sets typography, depth and layout deliberately, and avoids templated AI looks. Use when the user asks to build, redesign or prototype a web page, landing page, dashboard or component, or says their UI looks generic."
---

# Frontend design

## Goal

Interfaces that look made by a person with a point of view, not the sterile default that signals AI generation. A good result commits to one aesthetic direction, has deliberate type and spacing, uses real copy, and handles interaction states.

## When to use

- The user asks to design, build, redesign or prototype a web page, landing page, dashboard or UI component.
- The user says an existing interface looks generic or templated.
- For accessibility problems in a finished UI, use `use_skill` with `accessibility`.
- For slow rendering or bundle size, use `use_skill` with `performance`.

## Steps

1. Pick one archetype and stay in it. Never blend them into generic modern SaaS.
   - **Precision Utility** (Linear, Raycast, Supabase): dense, professional workspace for operators. Obsidian base (`#08090A`, `#0E1013`), razor-thin dividers (`rgba(255,255,255,0.07)`), crisp inset highlights. Neutral grotesque headings (`Geist`, `-0.03em` tracking) with technical monospaced metadata (`Geist Mono`, `JetBrains Mono`). Signatures: keyboard shortcuts (`<kbd>`), status dots, tabular figures (`font-variant-numeric: tabular-nums`), dense micro-padding (`px-2.5 py-1 text-xs`).
   - **Swiss Editorial** (Stripe Press, Kinfolk): sophisticated, print-inspired. Warm paper (`#FBF9F5`, `#F4EFEA`), deep ink (`#1A1816`), warm charcoal, one muted earthy accent (burnt clay, forest pine). A striking display serif (`Newsreader`, `Fraunces`, `Instrument Serif`) paired with a clean geometric sans (`Inter`, `Plus Jakarta Sans`). Signatures: asymmetric columns (5/7 splits), hairline rules (`border-stone-200`), oversized drop-caps or lead numbers, wide margins, deliberate negative space.
   - **Tactical Industrial** (Teenage Engineering): tangible, engineered, physical appliance feel. Anodized aluminum grey (`#E3E3E1`), matte black (`#141414`), warning orange (`#FF4400`), muted olive. Monospaced or technical grotesques (`Space Grotesk`, `Chivo Mono`, `IBM Plex Mono`). Signatures: hard box shadows (`shadow-[3px_3px_0px_#000]`), technical label caps (`tracking-widest uppercase text-[10px] font-mono`), tactile toggle switches, perimeter screw dots, measurement tickers.
   - **Monastic Minimalist** (Dieter Rams, Basecamp): intentional and radically uncluttered. White or single-tint light grey (`#FAFAFA`), charcoal text (`#171717`), no accent colors except for interactive states. One type family at every size, with contrast from scale and weight alone. Signatures: generous line heights, no decorative icons, focus on legibility and direct hierarchy.
2. Define the color matrix: base surface about 60%, structural borders and dividers about 30%, and exactly one accent color at about 10%.
3. Set typography, since it drives most of the perceived quality:
   - Display headings (`text-4xl` to `text-8xl`) get progressively tighter tracking: `tracking-[-0.02em]` at `text-4xl`, `tracking-[-0.035em]` to `tracking-[-0.05em]` at `text-6xl` and up.
   - Subheadings and lead paragraphs (`text-lg` to `text-xl`) use `tracking-[-0.01em]`.
   - Micro UI and metadata (`text-[10px]` to `text-xs`) widen tracking when uppercase. Bad: `<span className="text-xs uppercase">Recent commits</span>`. Good: `<span className="text-[11px] font-mono tracking-wider uppercase text-neutral-400">Recent commits</span>`.
   - Constrain prose to `max-w-[65ch]` or `max-w-[48ch]`. Descriptions never stretch across a full-width desktop container.
   - Tighten `leading` on large titles to `leading-[1.05]` through `leading-[1.15]`.
4. Build depth with layered shadows instead of a single `shadow-lg`:

```css
/* Dark surface */
box-shadow:
  0 0 0 1px rgba(255, 255, 255, 0.08),  /* razor highlight border */
  0 1px 2px rgba(0, 0, 0, 0.4),          /* contact shadow */
  0 4px 12px rgba(0, 0, 0, 0.3),         /* ambient depth */
  inset 0 1px 0 rgba(255, 255, 255, 0.08); /* inset rim light */

/* Light surface */
box-shadow:
  0 0 0 1px rgba(0, 0, 0, 0.05),
  0 1px 2px -1px rgba(0, 0, 0, 0.08),
  0 4px 16px -4px rgba(0, 0, 0, 0.04);
```

   Make buttons feel physical with an inset bevel:

```html
<!-- Dark mode tactile button -->
<button class="relative px-4 py-2 text-sm font-medium text-white transition-all duration-75
  bg-neutral-800 hover:bg-neutral-750 active:translate-y-[1px]
  rounded-md border border-neutral-700/80
  shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_1px_2px_0_rgba(0,0,0,0.4)]
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400">
  Run Benchmark
</button>
```

   For physical and editorial themes, add a micro-noise SVG data-URI overlay (`opacity-[0.03]`) or a subtle dot-grid mask.
5. Compose the layout asymmetrically.
   - Treat a card grid as a mosaic with varied density, for example a wide high-density data card (col span 8, row span 2) beside a single big metric (col span 4), then a row of a text spec with a quote, a syntax-highlighted code snippet, and a micro-status card with a live ping, branch tag and latency indicator (col span 4 each).
   - Break the centered hero. Use a 7/5 split: an oversized left-aligned typographic lockup with a direct call to action on the left, and an interactive component preview, terminal emulator or parameter inspector on the right. Or use an index hero: a top-heavy type section followed immediately by an editorial directory, index list or live data ledger instead of a product screenshot.
6. Write authentic copy with concrete domain facts, real numbers and genuine terminology:

| Replace this | With something like |
| --- | --- |
| "Supercharge your team's workflow with our AI-driven platform" | "Deterministic pipeline orchestration for distributed systems" |
| "Unlock deeper insights with powerful analytics" | "Inspect sub-second p99 latency regressions across all nodes" |
| "Seamless collaboration for modern teams" | "Shared workspace with real-time CRDT conflict resolution" |
| "Get Started Today / Learn More" | "Deploy Cluster / Read the Specs / Fork on GitHub" |
| "Trusted by 10,000+ businesses worldwide" | "Processing 42M daily transactions across 14 regions" |

7. Add interaction polish to every element:
   - Active states: `active:scale-[0.98]` or `active:translate-y-[1px]` on buttons, tabs and interactive cards.
   - Keyboard hints: subtle `<kbd>` tags in search bars (`⌘K`), buttons and modals.
   - Cards with nested links use a card-spanning anchor or clear cursor boundaries, never nested conflicting `<button>` elements.
   - Transitions are targeted and quick: `transition-colors duration-150 ease-out` or `transition-transform duration-100 ease-out`, never `transition-all duration-500` on everyday controls.
8. Assemble the code: modular and fully responsive, with semantic HTML5 elements (`<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`), no duplicate Tailwind classes, and complete interactive states. In an existing project, apply changes with `edit_file` or `write_file`. For a new page, use `create_file`. Check the result in a browser with `browser_navigate` and `browser_screenshot` when a local page can be opened.

## Gotchas

- Avoid the symmetrical hero pill: a centered badge (`✨ Introducing 2.0`), a centered H1 with a purple-to-blue gradient, a two-line subtitle and two rounded pill buttons.
- Avoid three identical cards, each with an icon in an accent squircle, a three-word title and a two-sentence filler description.
- Avoid aimless ambient blobs: large `blur-3xl opacity-20 bg-indigo-600` divs floating in backgrounds with no light source.
- Avoid uniform spacing (`p-6`, `gap-6`, `rounded-2xl` everywhere), which leaves no spatial tension.
- Avoid default Tailwind slate dark mode (`bg-slate-950`, `text-slate-400`, `border-slate-800`), heading gradients (`from-blue-400 via-purple-500 to-pink-500 bg-clip-text`) on every title, large headings with untouched tracking, and corporate copy like "Supercharge your workflow".
- Mixing two archetypes produces the generic SaaS look the skill exists to prevent. Commit to one.

## Output

Working, responsive code in the chosen archetype, delivered as files (`edit_file`, `write_file` or `create_file`). In the reply, name the archetype, the accent color and the type pairing in a couple of lines.
