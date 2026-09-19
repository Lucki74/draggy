---
name: frontend-design
description: "Architect and build high-end, human-crafted web interfaces in Draggy: eliminates AI aesthetic tropes, establishes editorial and engineering pedigree, and enforces strict typographic, spatial, and interaction standards."
---

# `frontend-design`: The Human-Crafted Web Engine

This skill re-wires Draggy's generative defaults. When tasked with designing, prototyping, or coding front-end interfaces (HTML, Tailwind CSS, React, Vue, Svelte, or Next.js), you must deliberately reject the "LLM Attractor State"—the sterile, predictable design patterns that immediately signal AI generation.

---

## 1. The Anti-Pattern Codex (Never Generate These)

### Structural & Layout Clichés
- **The Symmetrical Hero Pill:** A centered badge (`✨ Introducing 2.0`), a centered H1 with a purple-to-blue gradient, a 2-line subtitle, and two rounded pill buttons (`Get Started` and `Learn More`).
- **The Cookie-Cutter 3-Card Grid:** Three identical columns, each containing an icon inside an accent-colored squircle, a 3-word title, and a 2-sentence filler description.
- **The Aimless Ambient Blob:** Large divs with `blur-3xl`, `opacity-20`, and `bg-indigo-600` floating arbitrarily in section backgrounds without purpose or light-source grounding.
- **Uniform Spacing Syndrome:** Everything padded with standard `p-6`, `gap-6`, and `rounded-2xl`, resulting in visual mush with zero spatial tension.

### Typographic & Color Clichés
- **Default Tailwind Slate/Zinc Slop:** Pure dark mode built entirely of `bg-slate-950` with `text-slate-400` body copy and `border-slate-800`.
- **Indiscriminate Heading Gradients:** `bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent` applied to every major title.
- **Unadjusted Tracking:** Huge display headings (`text-5xl` or larger) rendered with default zero or positive letter-spacing instead of tight negative tracking.
- **Corporate Vacuum Copy:** "Supercharge your workflow," "The future of data management," "Seamless collaboration powered by intelligent insights."

---

## 2. Core Aesthetic Archetypes

Before writing code, analyze the user's intent and commit strictly to **one** of the following archetypes. Never blend them into generic modern SaaS.


```

┌───────────────────────────────────────────────────────────────────────────┐
│                           AESTHETIC TAXONOMY                              │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│ 1. Precision Utility │ 2. Swiss Editorial   │ 3. Tactical Industrial      │
│    (Linear, Raycast) │    (Stripe Press)    │    (Teenage Engineering)    │
├──────────────────────┼──────────────────────┼─────────────────────────────┤
│ 4. Warm Humanist     │ 5. Monastic Tech     │ 6. High-Contrast Neo-Brutal │
│    (Kinfolk, Aesop)  │    (Vercel, Basecamp)│    (Pitch, Arc Browser)     │
└──────────────────────┴──────────────────────┴─────────────────────────────┘

```

### Archetype 1: Precision Utility (Linear / Raycast / Supabase)
- **Vibe:** Dense, professional, low-latency workspace for operators.
- **Palette:** Obsidian base (`#08090A`, `#0E1013`), razor-thin dividers (`rgba(255,255,255,0.07)`), crisp inset highlights.
- **Typography:** Neutral grotesque headings (`Geist`, `-0.03em` tracking) paired with technical monospaced metadata (`Geist Mono`, `JetBrains Mono`).
- **Signatures:** Keyboard shortcuts (`<kbd>`), status indicator dots, tabular figures (`font-variant-numeric: tabular-nums`), dense micro-padding (`px-2.5 py-1 text-xs`).

### Archetype 2: Swiss Editorial & Graphic (Stripe Press / Kinfolk)
- **Vibe:** Sophisticated, timeless, print-inspired publication.
- **Palette:** Rich warm paper (`#FBF9F5`, `#F4EFEA`), deep sumi ink (`#1A1816`), warm charcoal, one muted earthy accent (burnt clay, forest pine).
- **Typography:** High-contrast pairing. Striking display serif (`Newsreader`, `Fraunces`, `Instrument Serif`) paired with clean geometric sans (`Inter`, `Plus Jakarta Sans`).
- **Signatures:** Asymmetric columns (5/7 grid splits), hairline rules (`border-stone-200`), oversized typographic drop-caps or lead numbers, wide margins, deliberate negative space.

### Archetype 3: Tactical Industrial (Teenage Engineering / Hardware Spec)
- **Vibe:** Tangible, engineered, physical appliance feel.
- **Palette:** Anodized aluminum grey (`#E3E3E1`), matte industrial black (`#141414`), warning orange (`#FF4400`), muted olive.
- **Typography:** Monospaced or technical grotesques (`Space Grotesk`, `Chivo Mono`, `IBM Plex Mono`).
- **Signatures:** Hard box shadows (`shadow-[3px_3px_0px_#000]`), technical label caps (`tracking-widest uppercase text-[10px] font-mono`), toggle switches with tactile bevels, perimeter screw dots, measurement tickers.

### Archetype 4: Monastic Minimalist (Dieter Rams / Basecamp)
- **Vibe:** Intentional, focused, radically uncluttered.
- **Palette:** Pure white or single-tint light grey (`#FAFAFA`), deep charcoal text (`#171717`), zero accent colors except for interactive states.
- **Typography:** Single typographic family used across all sizes, relying strictly on scale and weight for contrast.
- **Signatures:** Generous line heights, zero decorative icons, heavy focus on content legibility and direct hierarchy.

---

## 3. Typographic Engineering

Typography dictates 80% of a site's perceived quality. Execute with graphic design precision:

### Optical Tracking Rules
- **Display Headings (`text-4xl` to `text-8xl`):** Tighten tracking progressively.
  - Large titles (`text-4xl`): `tracking-[-0.02em]`
  - Massive hero titles (`text-6xl+`): `tracking-[-0.035em]` to `tracking-[-0.05em]`
- **Subheadings & Lead Paragraphs (`text-lg` to `text-xl`):** Neutral tracking (`tracking-[-0.01em]`).
- **Micro UI & Metadata (`text-[10px]` to `text-xs`):** Always widen tracking when uppercase.
  - Bad: `<span className="text-xs uppercase">Recent commits</span>`
  - Good: `<span className="text-[11px] font-mono tracking-wider uppercase text-neutral-400">Recent commits</span>`

### Vertical Rhythm & Measure (Line Length)
- **Max Characters per Line:** Constrain long-form prose and descriptions to `max-w-[65ch]` or `max-w-[48ch]`. Never allow descriptive paragraphs to stretch across full-width desktop containers.
- **Heading Line Height:** Always tighten `leading` on large titles (`leading-[1.05]` to `leading-[1.15]`). Default line heights on large fonts make headers feel disconnected.

---

## 4. Surfaces, Depth & Materiality

AI designs are flat and plastic. Real interfaces have tactile depth, calibrated lighting, and surface materiality.

### Layered Elevation (Forget Generic `shadow-lg`)
Instead of a single dark blurry shadow, build realistic ambient occlusion:

```css
/* High-End Dark Surface Shadow */
box-shadow: 
  0 0 0 1px rgba(255, 255, 255, 0.08),  /* Razor highlight border */
  0 1px 2px rgba(0, 0, 0, 0.4),          /* Contact shadow */
  0 4px 12px rgba(0, 0, 0, 0.3),         /* Ambient depth */
  inset 0 1px 0 rgba(255, 255, 255, 0.08); /* Inset rim light */

/* High-End Light Surface Shadow */
box-shadow:
  0 0 0 1px rgba(0, 0, 0, 0.05),
  0 1px 2px -1px rgba(0, 0, 0, 0.08),
  0 4px 16px -4px rgba(0, 0, 0, 0.04);

```

### Inset Bevels & Tactile Buttons

Create buttons that feel physical and clickable:

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

### Noise and Texture Overlay

For physical and editorial themes, inject a micro-noise SVG data-URI into background overlays (`opacity-[0.03]`) or subtle dot-grid masks to give digital pixels organic friction.

---

## 5. Spatial Composition & Grid Engineering

### Asymmetric Bento Grids

Never create a grid of three identical cards. Treat the grid as a mosaic with varied density:

```
┌──────────────────────────────────────────────┬────────────────────────┐
│ [Card 1: High Density Data Visualizer]        │ [Card 2: Single Metric]│
│ Features live interactive chart, sparklines, │ Big number: 99.4%      │
│ toggle filters, and dense table rows.        │ Small sparkline graph  │
│ (Col Span 8, Row Span 2)                     │ (Col Span 4)           │
├──────────────────────┬───────────────────────┼────────────────────────┤
│ [Card 3: Text Spec]  │ [Card 4: Code Block]  │ [Card 5: Micro Status] │
│ Editorial quote +    │ Syntax-highlighted    │ Live ping, branch tag, │
│ author portrait.     │ config snippet.       │ latency indicator.     │
│ (Col Span 4)         │ (Col Span 4)          │ (Col Span 4)           │
└──────────────────────┴───────────────────────┴────────────────────────┘

```

### Off-Center Hero Layouts

Break the default centered column. Anchor content intentionally:

* **7/5 Asymmetric Split:** 7 columns on the left with an oversized, left-aligned typographic lockup and direct CTA; 5 columns on the right featuring an interactive component preview, terminal emulator, or high-density parameter inspector.
* **The Index Hero:** A top-heavy typography section followed immediately by an editorial directory, index list, or live data ledger instead of a generic product screenshot.

---

## 6. Copywriting & Voice Standards

The copy generated by AI ruins designs before the layout even renders. Replace vague marketing puffery with concrete domain reality:

| Banned AI Marketing Jargon | Senior Product / Engineering Equivalent |
| --- | --- |
| "Supercharge your team's workflow with our AI-driven platform" | "Deterministic pipeline orchestration for distributed systems" |
| "Unlock deeper insights with powerful analytics" | "Inspect sub-second p99 latency regressions across all nodes" |
| "Seamless collaboration for modern teams" | "Shared workspace with real-time CRDT conflict resolution" |
| "Get Started Today / Learn More" | "Deploy Cluster / Read the Specs / Fork on GitHub" |
| "Trusted by 10,000+ businesses worldwide" | "Processing 42M daily transactions across 14 regions" |

---

## 7. Interactive Micro-States & Polish

Every element must acknowledge the human touch:

1. **Active States:** Always supply `active:scale-[0.98]` or `active:translate-y-[1px]` for buttons, tabs, and interactive cards.
2. **Keyboard Ergonomics:** Include subtle `<kbd>` tags inside search bars (`⌘K`), buttons, and modals.
3. **Cursor Intent:** Interactive cards with nested links must use proper card-spanning anchors or clear cursor boundaries—never nested conflicting `<button>` elements.
4. **Transition Restraint:** Never use `transition-all duration-500` on everyday UI controls. Use targeted, snappier transitions: `transition-colors duration-150 ease-out` or `transition-transform duration-100 ease-out`.

---

## 8. Generation Workflow (Step-by-Step Execution)

When the user asks you to build, redesign, or prototype a web page or component in Draggy, execute these steps:

1. **Archetype Selection:** Pick one archetype (e.g., *Precision Utility* or *Swiss Editorial*). Never drift into standard SaaS default.
2. **Color Palette Matrix:** Define base surface (60%), structural borders/dividers (30%), and exactly **one** surgical accent color (10%).
3. **Typography Stack:** Pick font pairings, negative display tracking, and uppercase micro-tracking.
4. **Layout Architecture:** Draft an asymmetric grid. Design high-density focal points and varied card anatomy.
5. **Authentic Domain Copy:** Write concrete, technical, or editorial copy with real numbers, realistic technical fields, and genuine terminology.
6. **Code Assembly:** Deliver modular, fully responsive code with semantic HTML5 elements (`<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`), zero duplicate Tailwind classes, and complete interactive states. In Draggy's code mode, apply changes using `edit_file` or `write_file`.