---
name: react-component-design
description: Designs or restructures React components with clear props, state ownership and composition, and splits oversized components along real seams. Use when the user asks how to structure a React component, to split a giant component, or to clean up props and state.
---

# React component design

## Goal

Give each component one job, a small honest props surface and state that lives at the lowest level that needs it. A good result is a component tree where a reader can say what each piece renders and who owns each value.

## When to use

- The user asks how to design, split or restructure a React component.
- A component has grown past a few hundred lines or takes a dozen props.
- For deciding where app-wide state lives, use `use_skill` with `state-management-review`.
- For loading and error rendering of a data view, use `use_skill` with `loading-and-empty-states`.
- The user asks whether to use a custom hook, a context or a prop for sharing logic.
- A component is hard to test because rendering, fetching and formatting are mixed together.

## Steps

1. Read the component with `read_file`. Note its props, its state and effects, and which JSX blocks are repeated or conditionally swapped.
2. Run `search_files` for the component name to see every caller and which props they actually pass. Props nobody passes are candidates for removal.
3. List each piece of state and ask who reads it. If only one child reads it, move it down. If two siblings read it, lift it to their nearest common parent and no higher.
4. Mark values that can be computed from props or other state. Compute them during render instead of storing them and syncing with an effect.
5. Find seams for splitting: a block with its own state, a block repeated in a list, a block that could be reused elsewhere. Do not split by line count alone.
6. Replace boolean flag props that switch layout (`isCompact`, `isLarge`, `withIcon`) with composition: accept `children` or named slots, or a single `variant` prop with a closed set of values.
7. Check the project's conventions (file layout, naming, styling approach, test setup) by reading two neighbouring components, then match them.
8. Apply the change with `edit_file` in small steps, and run the type checker and tests with `run_command` after each split.
9. Pull data fetching and formatting out of the render path into a hook or a small pure function, so the component only maps data to markup.
10. Add or update tests for each new piece with `write_file` or `edit_file`: the pure functions directly, the components through what the user sees.

## Gotchas

- Lifting state "just in case" makes every keystroke re-render a large subtree. Keep state local until a second reader appears.
- A prop that copies another prop into `useState` goes stale when the parent updates. Either derive it, or reset it deliberately with a `key` on the component.
- An effect that sets state from other state is a derived value in disguise and causes an extra render pass. Compute it in render, or memoize only if it is measurably costly.
- Defining a component inside another component's body creates a new type each render, so React remounts it and the children lose state and focus. Declare components at module level.
- Using the array index as a `key` in a reorderable list attaches state to the wrong row after a sort or delete. Use a stable id.
- Splitting into many tiny files that each take ten props moves the complexity instead of removing it. If the props list grows, the seam is wrong.
- Memoizing everything by habit adds comparison cost and stale-closure bugs. Measure first, then memoize the one expensive subtree.
- Passing a new object or inline function as a prop to a memoized child defeats the memo. Stabilize it or drop the memo.
- A context holding frequently changing values re-renders all consumers. Split fast-changing and slow-changing values into separate contexts.

## Output

- A short description of the proposed tree: component names, one line of responsibility each, and where each piece of state lives.
- The edits applied, or a diff-style sketch if the user asked for a plan only.
- Test and type check results, plus any behaviour you could not verify without running the UI.
- If you left any smell in place on purpose, name it and say why, so the next reader does not assume it was missed.
