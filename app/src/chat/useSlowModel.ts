import { useEffect, useState } from "react";
import { isSlowModel } from "../slowMode";

/** Whether `model` is a colibri model the planner expects to answer under 3 tokens per second. */
export function useSlowModel(model: string): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let current = true;
    // The answer comes from the main process, so it can only be set once it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- no answer yet, no notice
    setSlow(false);
    if (model) {
      void isSlowModel(model).then((value) => {
        if (current) setSlow(value);
      });
    }
    return () => {
      current = false;
    };
  }, [model]);
  return slow;
}
