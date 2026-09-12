import { describe, expect, it } from "vitest";
import {
  MAX_PLAN_ITEMS,
  addItem,
  currentItem,
  describeEdit,
  isFinished,
  moveItem,
  parsePlan,
  planSummary,
  removeItem,
  renderPlan,
  samePlan,
  toggleItem,
} from "../plan/plan";

/**
 * The plan. What matters is that a small model can write one without getting
 * the format wrong, and that the user can change it underneath without the two
 * of them ending up with different lists.
 */

describe("reading what the model wrote", () => {
  it("takes a plain checklist", () => {
    const items = parsePlan("[x] Read the config\n[>] Change the port\n[ ] Run the tests");

    expect(items.map((item) => item.status)).toEqual(["done", "doing", "todo"]);
    expect(items[1].text).toBe("Change the port");
  });

  it("forgives the bullets and numbers a model adds", () => {
    const items = parsePlan("1. [x] First\n- [ ] Second\n* [>] Third");

    expect(items.map((item) => item.text)).toEqual(["First", "Second", "Third"]);
    expect(items[0].status).toBe("done");
  });

  it("treats a line with no mark as a step still to do", () => {
    const items = parsePlan("Read the file\nChange it");

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === "todo")).toBe(true);
  });

  it("understands the words as well as the marks", () => {
    const items = parsePlan("[done] First\n[doing] Second");

    expect(items.map((item) => item.status)).toEqual(["done", "doing"]);
  });

  it("keeps only one step in hand", () => {
    // A model that marks three steps as in progress has not understood the
    // plan; the first one counts and the rest go back to waiting.
    const items = parsePlan("[>] First\n[>] Second\n[>] Third");

    expect(items.map((item) => item.status)).toEqual(["doing", "todo", "todo"]);
  });

  it("ignores blank lines and an empty plan", () => {
    expect(parsePlan("\n\n  \n")).toEqual([]);
    expect(parsePlan("")).toEqual([]);
  });

  it("stops before a plan becomes a wall of text", () => {
    const many = Array.from({ length: 40 }, (_, i) => `[ ] Step ${i}`).join("\n");

    expect(parsePlan(many)).toHaveLength(MAX_PLAN_ITEMS);
  });

  it("comes back out the way it went in", () => {
    const text = "[x] First\n[>] Second\n[ ] Third";

    expect(renderPlan(parsePlan(text))).toBe(text);
  });
});

describe("where the plan stands", () => {
  const items = parsePlan("[x] First\n[>] Second\n[ ] Third");

  it("counts what is done", () => {
    expect(planSummary(items)).toEqual({ done: 1, total: 3 });
  });

  it("names the step in hand", () => {
    expect(currentItem(items)?.text).toBe("Second");
  });

  it("falls back to the next one waiting", () => {
    expect(currentItem(parsePlan("[x] First\n[ ] Second"))?.text).toBe("Second");
  });

  it("knows when there is nothing left", () => {
    expect(isFinished(parsePlan("[x] First\n[x] Second"))).toBe(true);
    expect(isFinished(items)).toBe(false);
    expect(isFinished([])).toBe(false);
  });
});

describe("the user changing it", () => {
  const items = parsePlan("[ ] First\n[ ] Second\n[ ] Third");

  it("ticks a step off and back on", () => {
    const ticked = toggleItem(items, "step-2");
    expect(ticked[1].status).toBe("done");

    expect(toggleItem(ticked, "step-2")[1].status).toBe("todo");
  });

  it("adds a step at the end", () => {
    const added = addItem(items, "  Fourth  ");

    expect(added).toHaveLength(4);
    expect(added[3].text).toBe("Fourth");
    expect(added[3].id).toBe("step-4");
  });

  it("refuses an empty step", () => {
    expect(addItem(items, "   ")).toBe(items);
  });

  it("takes a step out and renumbers the rest", () => {
    const removed = removeItem(items, "step-1");

    expect(removed.map((item) => item.text)).toEqual(["Second", "Third"]);
    expect(removed.map((item) => item.id)).toEqual(["step-1", "step-2"]);
  });

  it("moves a step up and down", () => {
    expect(moveItem(items, "step-3", -1).map((item) => item.text)).toEqual([
      "First",
      "Third",
      "Second",
    ]);
    expect(moveItem(items, "step-1", 1).map((item) => item.text)).toEqual([
      "Second",
      "First",
      "Third",
    ]);
  });

  it("does not move the ends off the list", () => {
    expect(moveItem(items, "step-1", -1)).toBe(items);
    expect(moveItem(items, "step-3", 1)).toBe(items);
  });
});

describe("telling the model it changed", () => {
  it("notices a different plan", () => {
    const before = parsePlan("[ ] First\n[ ] Second");

    expect(samePlan(before, parsePlan("[ ] First\n[ ] Second"))).toBe(true);
    expect(samePlan(before, toggleItem(before, "step-1"))).toBe(false);
    expect(samePlan(before, addItem(before, "Third"))).toBe(false);
  });

  it("hands over the list as it now reads", () => {
    const said = describeEdit(parsePlan("[x] First\n[ ] Second"));

    expect(said).toContain("[x] First");
    expect(said).toContain("[ ] Second");
    expect(said).toMatch(/user edited/i);
  });

  it("says plainly when the user threw the plan away", () => {
    expect(describeEdit([])).toMatch(/cleared/i);
  });
});
