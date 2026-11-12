---
name: memory-palace
description: Builds a memory palace for an ordered list by choosing a familiar route, assigning one station per item and writing vivid, odd image links, then runs a recall test. Use when the user asks to memorise a list, a sequence or a set of facts, or mentions the method of loci.
---

# Memory palace

## Goal

Give the user a route they know well, with one distinct image placed at each stop, so that walking the route in their head brings back the list in order. The images carry the items, the route carries the order.

## When to use

- The user must recall an ordered list: speech points, steps, a deck of items, names with facts.
- The user wants a mnemonic and has said ordinary repetition is not working.
- The user wants a long-term review schedule for a large body of facts: use `use_skill` with `spaced-repetition-schedule`.
- The user needs to understand ideas, not recall order: use `explain-concept`.

## Steps

1. **Get the list.** Use `ask_user` for the items and how exactly they must be recalled (word for word, any order, with details). Count them.
2. **Choose a place.** Ask the user for a place they know in detail, such as their home or a daily walk. Ask them to list stops in the order they would walk them: door, hall, shoe rack, stairs. Aim for as many stops as items, with a little spare.
3. **Check the route.** Stops must be distinct, in a fixed order and easy to picture. Remove stops that look alike, for example three identical windows. Ask the user to confirm the final route.
4. **Turn each item into an image.** For a concrete item, use the object. For an abstract item, use a sound-alike or a symbol the user already links to it. Ask the user to supply the image if one comes to them, since personal images stick best.
5. **Make it vivid.** Add action, size, odd combinations, sound or smell. A giant red stapler swallowing the door sticks, a small stapler by the door does not.
6. **Link image to stop.** Write one line per stop: stop, image, the item it stands for. Make the image interact with the stop.
7. **Walk it once.** Ask the user to walk the route in their head and say the items. Mark where they stall.
8. **Fix weak links.** For each stall, change the image to something stranger or move the stop. Do not repeat the same image harder.
9. **Test and schedule.** Ask for recall from the end back to the start, and a re-walk the next day and after a week.
10. **Add numbers and names.** For digits or names, agree a fixed code (a sound for each digit, a face for each name) before building images, and write the code down.
11. **Plan the maintenance.** Walk the route once a day for three days, then weekly, and say when the list can be dropped.

## Gotchas

- The method suits lists, sequences and arbitrary facts. It does not build understanding, so say so when the material needs reasoning.
- Reusing one palace for several lists makes old images interfere. Use another route or wait until the first list is done.
- Pretty images fade, and strange, active, personal ones last. Let the user own the images.
- Routes with repeated or ambiguous stops cause order errors. Test the route before loading it.
- Skipping the first walk-through leaves errors until the day they hurt. Run it immediately.
- Do not overload one stop with several items unless the user asks. One image per stop keeps recall clean.
- Building the images takes longer than the first reading of a list. Warn the user and budget the time.

## Output

The route as a numbered list of stops, each with its image and the item it encodes, plus a one-line instruction for the first walk. Use plain text so the user can copy it.
