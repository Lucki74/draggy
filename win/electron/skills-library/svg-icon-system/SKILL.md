---
name: svg-icon-system
description: Sets up one consistent SVG icon approach for a project, covering sizes, color inheritance, accessible names, delivery method and cleanup of mixed icon sources. Use when the user asks to set up an icon system, says icons look inconsistent, or asks how to load SVG icons.
---

# SVG icon system

## Goal

Icons that share one grid, stroke style and sizing, take their color from text, carry correct accessible names and ship without waste. A good result is one component or helper that every icon goes through.

## When to use

- Icons come from several sets, sizes or file formats and look uneven.
- The user wants to add or reorganize icons.
- For drawing or exporting new icons, the `icon-designer` workflow may already be installed in the user's environment, so ask before assuming.
- For the accessibility rules of icon buttons beyond icons, use `use_skill` with `accessibility`.
- A designer delivers a new icon set to be added to the product.
- Icon rendering looks blurry or misaligned at small sizes.

## Steps

1. Inventory current icons with `search_files`: `.svg` files, inline `<svg>` blocks, icon font classes, image tags pointing at icons and imports from icon packages. Count each source.
2. Pick one delivery method and one source set. Options are inline SVG components (best for color control and tree shaking), an SVG sprite with `<use>`, or files used as images (no color inheritance). Explain the tradeoff to the user and let them choose.
3. Define the grid and sizes: one `viewBox` (commonly 24 by 24), a small set of rendered sizes, and consistent stroke width or fill style.
4. Clean each SVG. Remove fixed width and height, set `fill` or `stroke` to `currentColor`, remove inline `style`, ids that can collide and editor metadata. Run an SVG optimizer with `run_command` if the project has one, and review the output.
5. Create an `Icon` component or helper with `create_file`: it takes a name and a size, applies `aria-hidden="true"` for decorative icons, and an accessible title when the icon stands alone.
6. Migrate usages in batches with `edit_file`. For icon-only buttons, put the name on the button (`aria-label` or visually hidden text), not on the icon.
7. Remove unused icons and dead imports. Check that the build output contains only icons that are used.
8. Check in the browser with `browser_navigate`: icons align with text, follow hover and disabled colors, and look right in dark mode.
9. Check pixel alignment at the sizes actually rendered: strokes on half pixels look blurry, so adjust the grid or stroke width for small sizes.
10. Document how to add an icon, name it and request one, in a short note next to the component.

## Gotchas

- A hardcoded `fill` inside the file blocks `currentColor`, so the icon ignores theme and state. Strip it, except in multi-color artwork.
- Importing a whole icon package into one barrel can pull hundreds of icons into the bundle. Import individually or generate a map.
- An icon-only button with no name is unlabelled to a screen reader. The name belongs on the button.
- Mixing outline and filled icons from different sets in one toolbar looks uneven even when the sizes match. Stay in one family.
- Duplicate `id` values inside inline SVG (gradients, masks) collide across the page and render the wrong one.
- `<use>` sprites cannot be styled inside the shadow boundary beyond inherited properties, so per-part colors need custom properties.
- Strokes scale with the icon, so a 24 unit icon drawn at 16 pixels gets thinner than one drawn for 16. Use `vector-effect` or provide size-specific variants if the weight matters.
- Embedding SVG through `<img>` blocks CSS styling of its contents. Use inline SVG when color or state must change.
- Large traced or exported SVGs with thousands of path points are heavy. Simplify the paths before they ship.

## Output

- The chosen method with a two-line reason, and the shared component.
- A migration count: icons converted, removed, left as exceptions.
- Usage notes for adding a new icon, short enough to paste into contributing docs.
- Include the exact steps a contributor follows to add icon number two.
