import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/icons/Icon";

/** One row along the bottom: mute, end, and the way back to the same chat as text. Captions
 * history and skipping a reply sit beside them, smaller. */

interface TalkControlsProps {
  live: boolean;
  muted: boolean;
  history: boolean;
  canSkip: boolean;
  t: (key: string) => string;
  onMute: () => void;
  onEnd: () => void;
  onHistory: () => void;
  onSkip: () => void;
  onShowChat: () => void;
}

export default function TalkControls({
  live,
  muted,
  history,
  canSkip,
  t,
  onMute,
  onEnd,
  onHistory,
  onSkip,
  onShowChat,
}: TalkControlsProps) {
  return (
    <div className="flex items-center gap-3">
      <Round
        icon={history ? "subtitles" : "subtitles-slash"}
        label={t("transcript")}
        pressed={history}
        small
        disabled={!live}
        onClick={onHistory}
      />
      <Round
        icon={muted ? "microphone-slash" : "microphone"}
        label={muted ? t("unmuteMic") : t("muteMic")}
        shortcut={t("keySpace")}
        pressed={muted}
        disabled={!live}
        onClick={onMute}
      />
      <Round icon="phone-disconnect" label={t("endConversation")} shortcut="Esc" danger onClick={onEnd} />
      <Round icon="skip-forward" label={t("skipReply")} small disabled={!canSkip} onClick={onSkip} />
      <Button variant="ghost" size="dense" className="ms-2" onClick={onShowChat}>
        {t("talkShowChat")}
      </Button>
    </div>
  );
}

function Round({
  icon,
  label,
  shortcut,
  pressed,
  danger,
  small,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  danger?: boolean;
  small?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  const tone = danger
    ? "border-rule bg-surface-base text-danger hover:bg-danger/10"
    : pressed
      ? "border-transparent bg-text-primary text-surface-canvas"
      : "border-rule bg-surface-base text-text-primary hover:bg-surface-raised";

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed === undefined || danger ? undefined : pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-pill border transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? "h-9 w-9" : "h-12 w-12"
      } ${tone}`}
    >
      <Icon name={icon} size={small ? 16 : 20} aria-hidden />
    </button>
  );
}
