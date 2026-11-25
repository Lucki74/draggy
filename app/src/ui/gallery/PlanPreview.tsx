import { useState } from "react";
import PlanPanel from "../../plan/PlanPanel";
import { parsePlan } from "../../plan/plan";
import { translations } from "../../translations";

const t = (key: string) => translations.en[key] || key;

/** The plan pane twice: mid-run, and stopped in plan mode waiting for review. */
export function PlanPreview() {
  const [items, setItems] = useState(() =>
    parsePlan("[x] Read the dock layout code\n[>] Move the plan into a pane\n[ ] Add the review step\n[ ] Mirror progress in the title bar"),
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-80 overflow-hidden rounded-lg border border-rule">
        <PlanPanel items={items} onChange={setItems} running t={t} />
      </div>
      <div className="h-80 overflow-hidden rounded-lg border border-rule">
        <PlanPanel items={items} onChange={setItems} running={false} awaitingReview onProceed={() => {}} onComment={() => {}} t={t} />
      </div>
    </div>
  );
}
