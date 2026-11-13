---
name: errand-route-planner
description: Orders a list of errands by place, opening hours and effort into a route that saves trips and fits the day. Use when the user asks to plan errands, in what order to run them, or how to fit them into one trip.
---

# Errand route planner

## Goal

Turn a pile of errands into one ordered route with times: nothing is visited when closed, cold items are bought last, and the user is home when planned.

## When to use

- The user has several stops in one area or day.
- Some stops have limited hours, queues or appointments.
- Dinner for the evening is `use_skill` with `meal-planner`.

## Steps

1. Ask with `ask_user` for the list of errands, the start and end point, the mode of travel, the day and the time window.
2. Ask which items are urgent, which are fixed by appointment, and what must be carried, such as heavy or cold goods.
3. Look up the address and opening hours of each stop on the official pages with `read_url` or `search_web`. Note the day's hours, and holiday hours if they apply.
4. Group stops by area. Put the stops that need a parcel, a form or ID in the same bag list.
5. Place fixed appointments first, then fit the others around them.
6. Order the rest to follow a loop with little backtracking, and put time-sensitive and heavy items late in the route.
7. Add travel time between stops using a map source, with a buffer for parking, queues or transit waits.
8. Check the total against the time window. Drop or move the least urgent stops if it does not fit.
9. Check bags and carry limits. Plan a drop-off at home if the load gets too heavy.
10. List what to bring at each stop: ID, forms, returns with receipts, payment methods and the shopping list.
11. Add a plan B for a stop that turns out to be closed, such as the nearest alternative.
12. Write the route as a numbered schedule with times and save it with `create_file` if the user wants it for later.

## Gotchas

- Ignoring closing times.
- Putting cold items first.
- Leaving the farthest stop with no buffer.
- Assuming opening hours are the same on every weekday.
- Forgetting to bring the item to be returned or posted.
- Planning a parcel pickup with no ID or tracking code.
- Planning a straight line on a map when the roads do not allow it.
- Visiting a busy place at its busiest hour when another slot was possible.

## Output

A numbered route with arrival times, opening hours, what to bring, and a plan B for each risky stop.
