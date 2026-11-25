import { Icon } from "../ui/icons/Icon";
import type { IconName } from "../ui/icons/Icon";

type Translate = (key: string) => string;

const CAPABILITIES: { id: string; icon: IconName; label: string }[] = [
  { id: "tools", icon: "gear-six", label: "capabilityTools" },
  { id: "vision", icon: "eye", label: "capabilityVision" },
  { id: "thinking", icon: "brain", label: "capabilityThinking" },
  { id: "image-generation", icon: "image", label: "capabilityImageGeneration" },
  { id: "embedding", icon: "database", label: "capabilityEmbedding" },
];

/** What a model can do as small icons, each named on hover and to screen readers. */
export function CapabilityIcons({ capabilities, t, size = 14 }: { capabilities: string[]; t: Translate; size?: number }) {
  const present = CAPABILITIES.filter((capability) => capabilities.includes(capability.id));
  if (present.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-text-secondary">
      {present.map((capability) => (
        <span key={capability.id} title={t(capability.label)} role="img" aria-label={t(capability.label)} className="inline-flex">
          <Icon name={capability.icon} size={size} />
        </span>
      ))}
    </span>
  );
}
