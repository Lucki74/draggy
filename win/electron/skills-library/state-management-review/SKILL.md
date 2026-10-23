---
name: state-management-review
description: Reviews how a frontend app stores and shares state, decides where each piece should live, and removes duplicated or derived state. Use when the user asks to review state management, whether they need Redux or a store, or why state gets out of sync.
---

# State management review

## Goal

Every piece of state has one owner, one place it is written and a clear reason it lives where it does. A good review ends with a short map of state by kind and a list of concrete moves that remove sync bugs.

## When to use

- The user asks to review or simplify how state is managed.
- Two parts of the UI disagree about the same value.
- The user asks whether to add a state library or replace one.
- For the shape of one component, use `use_skill` with `react-component-design`.
- Navigating back shows stale data, or a refresh loses what the user did.
- A team debates adopting or removing a state library.

## Steps

1. Inventory the stores and hooks. Use `search_files` for store creation, context providers, `useState` in top-level components, URL parameter reads and local storage access. Read the main ones with `read_file`.
2. Classify each piece of state into a kind: server data (fetched, cached), URL state (filters, page, selected id), form state, UI state (open panels, hover), and truly global client state (session, theme).
3. For server data, check whether a fetching and cache layer manages it or whether it is copied into a store by hand. Hand-copied server data is the usual source of stale views.
4. Look for duplicates: the same value stored twice, a list plus a separate "selected item" copy instead of a selected id, or a count stored next to the list it counts.
5. Look for derived values saved as state and for effects that exist only to copy one state into another.
6. Check shared state that is in fact local: a modal flag in a global store that only one component reads.
7. Trace two or three real user flows through the code, for example "edit an item, then go back to the list", and note where an old value can survive.
8. Write the findings with specific moves. If the user asked for changes, apply them with `edit_file` one slice at a time and run the tests with `run_command`.
9. Check persistence: what is saved to local storage or the URL, what survives reload, and whether saved shapes have a version for migrations.
10. Look at update paths: who is allowed to write each store, and whether writes can race (two requests resolving out of order).

## Gotchas

- Copying fetched data into a client store creates a second source of truth and a reason to invent refetch rules. Keep it in the fetch cache and read from there.
- Store a selected id, not the selected object. The object goes stale when the list updates.
- A global store is not wrong, but putting everything in it makes every change a global change. Move state down until it hurts, not up until it works.
- URL state is shared state with free back button support. Filters kept only in memory are lost on reload and cannot be linked.
- Adding a library does not fix unclear ownership. The same confusion moves into reducers and selectors.
- Context values rebuilt each render re-render every consumer. Check for new object literals in the provider before blaming the library.
- Optimistic updates without rollback leave the UI lying after a failed request. Check the failure path as carefully as the success path.
- Out-of-order responses overwrite newer data with older. Search handlers need a cancel or a request id check.
- Persisting a whole store to local storage restores bugs along with data. Persist the minimum and validate on load.

## Output

- A table of state by kind: name, owner, readers, and whether it should move.
- Ranked recommendations, each naming the files and the exact change, with the bug it prevents.
- A plain answer to the "do I need a library" question if it was asked, with the reasoning from this codebase.
- Keep recommendations to the few that remove real bugs, and mark pure style preferences as optional.
