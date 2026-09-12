/**
 * The plan a turn is working through. The model writes it with one tool call
 * and rewrites it as it goes; the user can edit it while that happens, which is
 * the difference between a plan and a progress bar.
 *
 * It is one string on the wire, marked the way a person would write a checklist,
 * because a small local model produces that far more reliably than nested JSON.
 */

export type PlanStatus = "todo" | "doing" | "done";

export interface PlanItem {
  id: string;
  text: string;
  status: PlanStatus;
}

const MARKS: Record<PlanStatus, string> = {
  todo: "[ ]",
  doing: "[>]",
  done: "[x]",
};

/** How many steps are worth showing before a plan is just a wall. */
export const MAX_PLAN_ITEMS = 20;

function statusOf(mark: string): PlanStatus {
  const inside = mark.trim().toLowerCase();
  if (inside === "x" || inside === "done") return "done";
  if (inside === ">" || inside === "-" || inside === "doing") return "doing";
  return "todo";
}

/**
 * Reads a checklist the model wrote. Anything that looks like a list item
 * counts, marked or not, because a model that forgets the brackets still meant
 * to write a step.
 */
export function parsePlan(text: string): PlanItem[] {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items: PlanItem[] = [];

  for (const line of lines) {
    if (items.length >= MAX_PLAN_ITEMS) break;

    // "1. [x] Something", "- [ ] Something", "[>] Something", "Something"
    const withoutBullet = line.replace(/^(?:[-*•]|\d+[.)])\s*/, "");
    const marked = withoutBullet.match(/^\[([^\]]*)\]\s*(.*)$/);

    const status = marked ? statusOf(marked[1]) : "todo";
    const body = (marked ? marked[2] : withoutBullet).trim();

    if (!body) continue;

    items.push({ id: `step-${items.length + 1}`, text: body, status });
  }

  // Exactly one step can be in hand at a time; a model that marks three is
  // told back what Draggy actually recorded.
  let seen = false;
  return items.map((item) => {
    if (item.status !== "doing") return item;
    if (seen) return { ...item, status: "todo" as const };
    seen = true;
    return item;
  });
}

/** The plan as text, for the model and for a tool result. */
export function renderPlan(items: PlanItem[]): string {
  return items.map((item) => `${MARKS[item.status]} ${item.text}`).join("\n");
}

export function planSummary(items: PlanItem[]): { done: number; total: number } {
  return {
    done: items.filter((item) => item.status === "done").length,
    total: items.length,
  };
}

export function isFinished(items: PlanItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === "done");
}

/** The step being worked on, or the next one waiting. */
export function currentItem(items: PlanItem[]): PlanItem | null {
  return (
    items.find((item) => item.status === "doing") ??
    items.find((item) => item.status === "todo") ??
    null
  );
}

export function samePlan(left: PlanItem[], right: PlanItem[]): boolean {
  if (left.length !== right.length) return false;

  return left.every(
    (item, index) =>
      item.text === right[index].text && item.status === right[index].status,
  );
}

/** Renumbers after an edit, so ids stay in the order the list reads. */
function renumber(items: PlanItem[]): PlanItem[] {
  return items.map((item, index) => ({ ...item, id: `step-${index + 1}` }));
}

export function toggleItem(items: PlanItem[], id: string): PlanItem[] {
  return renumber(
    items.map((item) =>
      item.id === id
        ? { ...item, status: item.status === "done" ? "todo" : "done" }
        : item,
    ),
  );
}

export function addItem(items: PlanItem[], text: string): PlanItem[] {
  const body = text.trim();
  if (!body || items.length >= MAX_PLAN_ITEMS) return items;

  return renumber([...items, { id: "new", text: body, status: "todo" }]);
}

export function removeItem(items: PlanItem[], id: string): PlanItem[] {
  return renumber(items.filter((item) => item.id !== id));
}

export function moveItem(
  items: PlanItem[],
  id: string,
  direction: -1 | 1,
): PlanItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return items;

  const target = index + direction;
  if (target < 0 || target >= items.length) return items;

  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];

  return renumber(next);
}

/** What the model is told when the user has changed the plan under it. */
export function describeEdit(items: PlanItem[]): string {
  if (items.length === 0) {
    return "The user cleared the plan. Ask them what they want instead of carrying on with the old steps.";
  }

  return `The user edited the plan. It now reads:

${renderPlan(items)}

Work to this, not to the version you wrote. Mark a step done as you finish it.`;
}

/** What the model is told at the start of a turn that already has a plan. */
export function describePlan(items: PlanItem[]): string {
  return `The plan for this task so far:

${renderPlan(items)}

Carry on from it. Call update_plan with the whole list whenever a step changes, and stop when every step is done.`;
}
