import Logo from "../../Logo";

/** The one screen with the dragon on it: who this is, in a sentence, and the way in. */
export default function Welcome({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex flex-col items-center pt-[10vh] text-center">
      <Logo className="h-20 w-20 text-text-primary" />
      <h1 className="display-line mt-8 text-balance text-[44px] font-semibold leading-[52px] tracking-[-0.02em] text-text-primary">
        {t("onbWelcomeTitle")}
      </h1>
      <p className="mt-3 max-w-[420px] text-[15px] leading-6 text-text-secondary">{t("onbWelcomeBody")}</p>
    </div>
  );
}
