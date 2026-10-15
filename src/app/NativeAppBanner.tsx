import { useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { logSwallow } from "../logger";
import { nativeAppPlatform } from "./nativeAppPlatform";

const SEEN_KEY = "draggy_native_banner";
const SITE = "https://draggy.org";

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  t: (key: string) => string;
}

/** Dismissal is remembered across launches, so the announcement stays gone once someone closes it. */
export default function NativeAppBanner({ t }: Props) {
  const [dismissed, setDismissed] = useState(dismissedBefore);
  const platform = nativeAppPlatform(navigator.userAgent);
  if (dismissed || !platform) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch (error) {
      logSwallow("app", error, "unsaved, so it returns next launch; the banner still goes");
    }
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b-2 border-rule-strong bg-surface-raised">
      <Icon name="info" size={16} className="flex-shrink-0 text-text-secondary" />
      <p className="flex-1 min-w-0 text-xs font-medium">{t(platform === "mac" ? "nativeBannerMac" : "nativeBannerLinux")}</p>
      <a
        href={SITE}
        target="_blank"
        rel="noreferrer"
        className="flex-shrink-0 text-xs font-medium text-text-primary underline underline-offset-2 decoration-rule-control hover:decoration-text-primary transition-colors"
      >
        {t("nativeBannerLearnMore")}
      </a>
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
