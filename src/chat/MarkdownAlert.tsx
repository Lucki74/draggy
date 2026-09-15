import React from "react";
import { AlertCircle, AlertTriangle, Info, Lightbulb, OctagonAlert } from "lucide-react";

/** GitHub-style alert callouts rendered from blockquotes with [!NOTE], [!TIP], etc. */

const ALERT_CONFIG: Record<string, { title: string; color: string; Icon: typeof AlertTriangle }> = {
  warning: { title: "Warning", color: "#d29922", Icon: AlertTriangle },
  note: { title: "Note", color: "#2f81f7", Icon: Info },
  tip: { title: "Tip", color: "#3fb950", Icon: Lightbulb },
  important: { title: "Important", color: "#a371f7", Icon: AlertCircle },
  caution: { title: "Caution", color: "#f85149", Icon: OctagonAlert },
};

function processAlertChildren(children: React.ReactNode) {
  const childArray = React.Children.toArray(children);
  const firstElemIndex = childArray.findIndex((c) => React.isValidElement(c));
  if (firstElemIndex === -1) return null;

  const firstElem = childArray[firstElemIndex] as React.ReactElement<{ children?: React.ReactNode }>;
  const pChildren = React.Children.toArray(firstElem.props.children);
  if (pChildren.length === 0) return null;

  const firstText = pChildren[0];
  if (typeof firstText !== "string") return null;

  const match = firstText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|[ \t]+|$)([\s\S]*)/i);
  if (!match) return null;

  const type = match[1].toLowerCase();
  const remainder = match[2];

  const newPChildren = remainder
    ? [remainder, ...pChildren.slice(1)]
    : pChildren.slice(1);

  const newFirstElem = newPChildren.length > 0
    ? React.cloneElement(firstElem, {}, ...newPChildren)
    : null;

  const newChildren = [
    ...childArray.slice(0, firstElemIndex),
    ...(newFirstElem ? [newFirstElem] : []),
    ...childArray.slice(firstElemIndex + 1),
  ];

  return { type, newChildren };
}

export function MarkdownBlockquote({ children, ...props }: React.ComponentPropsWithoutRef<"blockquote">) {
  const alert = processAlertChildren(children);
  if (alert) {
    const config = ALERT_CONFIG[alert.type] || ALERT_CONFIG.note;
    const Icon = config.Icon;
    return (
      <div
        className="my-4 pl-4 py-1.5 border-l-[3.5px] text-[var(--text-main)]"
        style={{ borderColor: config.color }}
      >
        <div
          className="flex items-center gap-2 mb-1.5 font-semibold text-sm"
          style={{ color: config.color }}
        >
          <Icon className="w-4 h-4 flex-shrink-0" />
          <span>{config.title}</span>
        </div>
        <div className="text-sm leading-relaxed [&>p:last-child]:mb-0 [&>p]:mb-2">
          {alert.newChildren}
        </div>
      </div>
    );
  }

  return (
    <blockquote
      className="my-3 border-l-4 border-[var(--border-light)] pl-4 py-1 text-[var(--text-muted)] italic"
      {...props}
    >
      {children}
    </blockquote>
  );
}
