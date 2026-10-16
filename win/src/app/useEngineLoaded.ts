import { useEffect, useState } from "react";
import { isRemote } from "../ai/providers";
import { describeLoadedModels } from "../llama";

const POLL_MS = 3000;

/** Whether the engine holds this model right now. A provider's model needs nothing loaded, so it is
 * always ready. Read again every few seconds and whenever `nudge` changes, since the model can be
 * loaded or unloaded from elsewhere in the app. */
export function useEngineLoaded(model: string | undefined, nudge?: unknown): boolean {
  const [loaded, setLoaded] = useState(false);
  const local = Boolean(model) && !isRemote(model!);

  useEffect(() => {
    if (!model || !local) return;
    let live = true;
    const target = model.toLowerCase().startsWith("gguf:") ? model.slice(5) : model;
    const read = () => {
      describeLoadedModels()
        .then((models) => live && setLoaded(models.some((entry) => entry.name === target)))
        .catch(() => live && setLoaded(false));
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [model, local, nudge]);

  if (!model) return false;
  return local ? loaded : true;
}
