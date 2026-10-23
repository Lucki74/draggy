---
name: animation-performance
description: Finds animations that drop frames because they trigger layout or paint, and moves them to compositor-friendly properties or better scheduling. Use when the user says an animation is laggy, scrolling effects stutter, or a transition feels rough.
---

# Animation performance

## Goal

Keep animations at the display's frame rate by changing only what the compositor can animate and by not forcing layout inside the frame. A good result names the property or script causing the cost and replaces it without changing the look.

## When to use

- A CSS transition, keyframe animation or scroll effect stutters.
- Motion is smooth on a desktop and rough on a phone.
- For choosing what the motion should feel like, use `use_skill` with `frontend-design`.
- For layout that is merely wrong, not slow, use `use_skill` with `css-layout-debugging`.
- A parallax or scroll-triggered section makes scrolling feel heavy.
- A newly added carousel, modal or menu transition drops frames on lower-end devices.

## Steps

1. Find the animation. Use `search_files` for `transition`, `animation`, `@keyframes`, `requestAnimationFrame`, scroll listeners and animation library calls. Read the matching code with `read_file`.
2. List the properties being animated. Opacity and transforms are cheap. Width, height, top, left, margin and box shadow force layout or paint each frame.
3. Check scripts that run during the animation: scroll or resize handlers that read layout values (`offsetHeight`, `getBoundingClientRect`) and then write styles, which forces repeated layout.
4. Reproduce in the browser with `browser_navigate`. Use `browser_console` to sample frame times with `requestAnimationFrame` deltas during the interaction, and report how many frames exceed the budget.
5. Replace costly properties: move with `transform: translate` instead of `top` or `left`, scale instead of resizing, fade with `opacity`. For height reveals consider animating a wrapper's transform or using grid row sizing carefully.
6. Batch reads before writes in scripts. Replace scroll handlers with `IntersectionObserver` or CSS scroll-driven features after checking support with `use_skill` and `browser-compat-check`.
7. Apply the fix with `edit_file`, then repeat step 4 and compare the frame numbers.
8. Respect `prefers-reduced-motion` by shortening or removing large movement.
9. Check images or videos inside animated elements: large layers eat memory, and decoding during motion causes hitches. Size and prepare them before the animation starts.
10. Test on the lowest-powered device the user can reach, or with strong CPU throttling in the browser and avoid relying on the development machine.

## Gotchas

- `will-change` on many elements reserves a GPU layer for each and can make things slower and use memory. Apply it briefly to the few elements that animate, and remove it after.
- Blur and large box shadows are paint-heavy even when the element only moves. Animating `filter: blur` on a big area is a frequent cause on phones.
- Transforms create stacking contexts and containing blocks, which can change how `position: fixed` children and `z-index` behave.
- Layout thrash hides in innocent code. A loop that reads a size and then sets a style on each item forces layout every iteration.
- Testing with the developer tools open or on a fast machine hides the problem. Throttle the CPU when measuring.
- Animating via state in a framework re-renders on every frame. Drive per-frame values with CSS or direct style writes instead.
- Animating CSS custom properties on a large subtree recalculates style for every descendant each frame. Animate the property directly on the target.
- A transition on `all` animates properties nobody meant to move, including layout ones. List the exact properties.
- Starting an animation in the same frame as the DOM change that sets its start value skips the transition. Force a frame before changing the end state.

## Output

- The offending property or script, with file and line.
- The fix as a diff, plus before and after frame time numbers if measured.
- A note on reduced-motion handling and any devices you could not test.
- State the target frame rate and how it was measured so the claim can be repeated.
