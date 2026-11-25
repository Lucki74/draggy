import { useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { fill } from "../onboarding/text";
import { isRemote, providerOf } from "../ai/providers";
import { logSwallow } from "../logger";

const SEEN_KEY = "draggy_remote_files_notice";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  model: string;
  /** The provider's label, when its instance is known. */
  provider?: string;
  /** Code with a project open, where the model reads the user's files. */
  inProject: boolean;
  t: (key: string) => string;
}

/** Shown once, the first time a provider's model works in a project: what it reads leaves the computer. */
export default function RemoteFilesNotice({ model, provider, inProject, t }: Props) {
  const [dismissed, setDismissed] = useState(seen);
  if (dismissed || !inProject || !isRemote(model)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch (error) {
      logSwallow("providers", error, "unsaved, it only comes back next launch; the card itself still goes");
    }
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b-2 border-rule-strong bg-surface-raised">
      <Icon name="file-arrow-up" size={16} className="flex-shrink-0 text-warn" />
      <p className="flex-1 min-w-0 text-xs font-medium">{fill(t("remoteFilesNotice"), { provider: provider ?? providerOf(model) ?? "" })}</p>
      <button
        type="button"
        onClick={dismiss}
        className="p-1 text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
        title={t("dismiss")}
        aria-label={t("dismiss")}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
