---
name: loading-and-empty-states
description: Designs and implements the loading, empty, error and partial states of a data view so none of them is an afterthought. Use when the user asks for a loading state, what an empty state should show, or how to handle errors in a list or page.
---

# Loading and empty states

## Goal

A data view always shows something truthful and useful: that it is loading, that it has nothing yet, that it failed, or the data. A good result has a distinct, tested rendering for each state and no layout jumps between them.

## When to use

- A list, table, dashboard or detail view needs its non-happy-path states.
- Users see flashes of an empty message while data loads.
- For validation errors in a form, use `use_skill` with `form-validation-ux`.
- For the structure of the component itself, use `use_skill` with `react-component-design`.
- A new list, table or chart is being built and only the success case is coded.
- Users report a blank screen with no explanation.

## Steps

1. Read the view and its data hook with `read_file`. Identify the possible states: first load, refetch with old data, success with items, success with none, error with and without old data.
2. Make the state explicit in code, as one status value or a discriminated type, instead of several booleans that can contradict each other.
3. Design each state. Loading shows a skeleton that matches the final layout, or a quiet indicator for short waits. Empty explains why it is empty and offers the next action. Error says what failed in plain words and offers retry.
4. Handle refetch separately from first load. Keep showing the old data with a subtle busy cue instead of replacing it with a skeleton.
5. Decide on delays: show a loading indicator only after a short wait, such as a few hundred milliseconds, and keep it visible for a minimum time to avoid a flicker. Choose values with the user and test them.
6. Reserve space. Give skeleton rows the same height as real rows, and reserve image dimensions.
7. Implement with `edit_file`. Add the states to any existing component tests or storybook-style fixtures with `search_files` to find them.
8. Verify in the browser with `browser_navigate`. Force each state by throttling, blocking the request or returning an empty list, and take a `browser_screenshot` of each.
9. Add the paginated and infinite-list cases: loading more at the end, an error on the next page without losing earlier items, and a clear end-of-list signal.
10. Write the user-facing copy for each state with the user, and keep it short, specific and free of blame.

## Gotchas

- Treating "no data yet" as "empty" shows "Nothing here" for a moment on every load. Empty is only valid after a successful response.
- A spinner with no timeout hangs forever when the request never settles. Add a timeout path that turns into the error state.
- Error states that replace the whole page throw away data the user could still use. Keep stale data visible with an inline error when possible.
- Skeletons of the wrong shape cause a layout shift when the real content lands, which hurts the vitals scores and feels broken.
- Empty states for filtered results differ from empty states for a new account. The first needs a clear-filters action, the second an onboarding action.
- Announce state changes to assistive technology with a polite live region, or screen reader users never learn that loading finished.
- A retry button that refires the same failing request in a tight loop hammers the server. Add a short delay or disable it while retrying.
- Offline and server-down are different errors with different advice. Distinguish them if the data layer can tell.
- Skeleton animation that never stops is distracting when loading takes seconds. Keep motion subtle and respect reduced motion.

## Output

- A state table: state, trigger, what the user sees, available action.
- The implementation diff and which states have tests.
- Screenshots or notes confirming each state, and any state you could not force.
- List the states covered by tests and the ones only checked by hand.
