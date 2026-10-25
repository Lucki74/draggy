---
name: shot-list
description: Builds a shoot-day shot list from a script or storyboard, grouped by location, with framing, coverage, b-roll, audio needs, gear and permissions. Use when the user asks for a shot list, to plan a shoot, or what shots they need to capture.
---

# Shot list

## Goal

Give the person filming a practical list they can work through on the day. Shots are grouped to minimise moves, coverage is enough for the edit, and nothing important (audio, permissions, release forms) is forgotten.

## When to use

- The user has a script, outline or storyboard and is about to shoot.
- The user is filming an event, product, interview or tutorial and needs coverage planned.
- For the visual sequence before this, use `use_skill` with `storyboard`. For the plan after filming, use `use_skill` with `video-edit-plan`.

## Steps

1. Read the script or storyboard with `read_file`. Ask with `ask_user` for locations and times, the crew size, available gear (camera, lenses, tripod, mics, lights), the shooting days and the delivery format.
2. List every shot the story needs: for each, the scene, shot size, angle or move, subject, action and the line or purpose it covers. Use the storyboard numbers if they exist so the edit can map back.
3. Add coverage the story did not name: a wide establishing shot for each location, close-ups of hands or key objects, reaction shots, cutaways and ambient b-roll. Aim for more b-roll than seems needed.
4. Regroup by location and then by lighting and camera setup, not by story order. Within a setup, shoot wide to tight. Put the hardest or weather-dependent shots first. Note the story order in a column so the editor can restore it.
5. Add audio: dialogue mic plan, room tone for 30 to 60 seconds at each location, and wild sound for effects. Poor audio is harder to fix than poor picture.
6. Add the practical column: permits and permissions for locations, release forms for people who appear, music or logos in frame, power, travel time, sunrise and sunset times from a live source such as `search_web`, and a backup plan for weather.
7. Estimate the time per setup with the user and use `run_code` to total it. Compare with the available hours and mark the shots that drop first if time runs out.
8. Save with `create_file` as `shot-list.md`, one table, with a tick column.
9. Run a ten minute gear check the day before: charged batteries, free card space, mic test, lens cleaning and a test clip played back on a laptop.

## Gotchas

- Shooting in script order wastes the day on moves and lighting changes.
- A single take per shot with no safety take is risky for things that cannot be repeated.
- Continuity details (clothes, props, time of day) need notes on the list, or the cut will jump.
- Recording on a phone in portrait for a landscape delivery wastes frame. Settle the orientation before the first shot.
- Filming people in public or private places can need consent. Ask, and do not assume.
- Sunrise and sunset times change daily. Read them for the shoot date, not from memory.
- Interviews need a quiet check at the location, since a fridge or traffic you stopped noticing ruins audio.
- Backing up cards on site before leaving prevents the worst kind of loss. Put it on the list.

## Output

- The gear check and backup plan as the last block.
- A table: setup, location, shot, size and angle, action, audio, gear, story order, done.
- Time estimate versus time available, with the drop list.
- A pre-shoot checklist of gear, permissions and batteries.
