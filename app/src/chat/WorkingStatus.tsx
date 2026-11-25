import { useEffect, useState } from "react";
import { Spark } from "../ui";
import { workingVerbsFor } from "../workingVerbs";

const SWAP_MS = 3000;

/** The pool in a fresh random order, so no verb comes back before the rest have had a turn. */
function shuffled(pool: string[]) {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The mark under a busy reply: a spark and a playful verb that changes every few seconds.
export function WorkingStatus({ language }: { language: string }) {
  const [order] = useState(() => shuffled(workingVerbsFor(language)));
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => value + 1), SWAP_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 h-6 text-[13px] text-text-secondary">
      <Spark />
      <span role="status">{order[index % order.length]}…</span>
    </div>
  );
}
export default WorkingStatus;
