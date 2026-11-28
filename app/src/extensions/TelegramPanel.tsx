import { useEffect, useState } from "react";
import { Block, Button, FIELD, Group, Row, Segmented, Select, Toggle } from "../settings/Controls";
import { workspaceLabel } from "../workspaces";
import { swallowed } from "../logger";
import type { AppSettings, TelegramStatus, Workspace } from "../types";

interface TelegramPanelProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  workspaces: Workspace[];
  t: (key: string) => string;
}

/** Extensions > Telegram: a bot that carries a Draggy chat to a phone. The token goes to the app's
 * keystore and never comes back; only whether one is set does. */
export default function TelegramPanel({ settings, onUpdate, workspaces, t }: TelegramPanelProps) {
  const api = window.draggy?.telegram;
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(swallowed("extensions", "the main process already logged this call"));
    const off = api.onStatus(setStatus);
    return () => {
      cancelled = true;
      off();
    };
  }, [api]);

  const pairing = status?.pairing ?? null;
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  if (!api) {
    return <p className="text-[13px] text-text-tertiary">{t("telegramUnavailable")}</p>;
  }

  const run = (call: Promise<TelegramStatus>) => void call.then(setStatus).catch(swallowed("extensions", "the main process already logged this call"));
  const saveToken = () => {
    const value = token.trim();
    if (!value) return;
    setToken("");
    run(api.setToken(value));
  };

  const minutesLeft = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 60000)) : 0;
  const codeLive = pairing !== null && pairing.expiresAt > now;
  const state = !status?.hasToken
    ? t("telegramNoToken")
    : status.error
      ? status.error
      : status.running
        ? `${t("telegramRunning")}${status.bot ? ` · @${status.bot}` : ""}`
        : t("telegramOff");

  return (
    <div className="space-y-6">
      <p className="text-[13px] leading-5 text-text-secondary">{t("telegramDescription")}</p>
      <Group title={t("telegramBot")}>
        <Row label={t("telegramToken")} description={status?.hasToken ? t("telegramTokenSaved") : undefined}>
          <div className="flex items-center gap-2">
            <input
              aria-label={t("telegramToken")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder={status?.hasToken ? "••••••••" : "123456:ABC…"}
              onChange={(e) => setToken(e.target.value)}
              className={`${FIELD} font-mono text-[12px]`}
            />
            <Button onClick={saveToken} disabled={!token.trim()}>
              {t("telegramSaveToken")}
            </Button>
          </div>
        </Row>
        <Row label={t("telegramEnable")} description={state}>
          <Toggle
            label={t("telegramEnable")}
            checked={Boolean(status?.enabled)}
            disabled={!status?.hasToken}
            onChange={(enabled) => run(api.setEnabled(enabled))}
          />
        </Row>
      </Group>

      <Group title={t("telegramChats")}>
        <Row label={t("telegramProject")} description={t("telegramProjectHelp")}>
          <Select
            label={t("telegramProject")}
            value={settings.telegramWorkspaceId}
            options={workspaces.map((one) => ({ id: one.id, label: workspaceLabel(one, t) }))}
            onChange={(telegramWorkspaceId) => onUpdate({ telegramWorkspaceId })}
          />
        </Row>
        <Row label={t("telegramMode")}>
          <Segmented
            value={settings.telegramMode}
            options={[
              { id: "chat", label: t("chatMode") },
              { id: "code", label: t("codeMode") },
            ]}
            onChange={(telegramMode) => onUpdate({ telegramMode })}
            label={t("telegramMode")}
          />
        </Row>
      </Group>

      <Group title={t("telegramPaired")}>
        {(status?.paired ?? []).length === 0 ? (
          <Block>
            <p className="text-[13px] leading-5 text-text-tertiary">{t("telegramNoPaired")}</p>
          </Block>
        ) : (
          status?.paired.map((chat) => (
            <Row key={chat.chatId} label={chat.name || chat.chatId}>
              <Button tone="danger" onClick={() => run(api.unpair(chat.chatId))}>
                {t("telegramUnpair")}
              </Button>
            </Row>
          ))
        )}
        <Block>
          {codeLive && pairing ? (
            <div className="space-y-1">
              <p className="font-mono text-[28px] font-semibold tracking-[0.3em] text-text-primary">{pairing.code}</p>
              <p className="text-[13px] leading-5 text-text-secondary">
                {t("telegramPairHelp").replace("{minutes}", String(minutesLeft))}
              </p>
            </div>
          ) : status && status.lockedSecs > 0 ? (
            <p className="text-[13px] leading-5 text-danger">
              {t("telegramLocked").replace("{minutes}", String(Math.ceil(status.lockedSecs / 60)))}
            </p>
          ) : null}
          <div className="mt-3">
            <Button tone="primary" onClick={() => run(api.pairStart())} disabled={!status?.running}>
              {t("telegramPair")}
            </Button>
          </div>
        </Block>
      </Group>
    </div>
  );
}
