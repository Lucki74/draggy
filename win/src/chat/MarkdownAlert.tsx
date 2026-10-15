import React from "react";
import { Icon, type IconName } from "../ui";

/** GitHub-style alert callouts rendered from blockquotes with [!NOTE], [!TIP], etc. */

/** Only warning and caution report a state, so only they take a status color. */
const ALERT_CONFIG: Record<string, { title: string; text: string; border: string; icon: IconName }> = {
  warning: { title: "Warning", text: "text-warn", border: "border-warn", icon: "warning" },
  note: { title: "Note", text: "text-text-primary", border: "border-rule-strong", icon: "info" },
  tip: { title: "Tip", text: "text-text-primary", border: "border-rule-strong", icon: "lightbulb" },
  important: { title: "Important", text: "text-text-primary", border: "border-rule-strong", icon: "warning-circle" },
  caution: { title: "Caution", text: "text-danger", border: "border-danger", icon: "warning-octagon" },
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
    return (
      <div className={`my-4 ps-4 py-0.5 border-s-2 ${config.border}`}>
        <div className={`flex items-center gap-2 mb-1 text-[13px] font-semibold ${config.text}`}>
          <Icon name={config.icon} size={16} className="flex-shrink-0" />
          <span>{config.title}</span>
        </div>
        <div className="text-text-primary [&>p:last-child]:mb-0 [&>p]:mb-2">{alert.newChildren}</div>
      </div>
    );
  }

  return (
    <blockquote
      className="my-4 border-s-2 border-rule-strong ps-4 text-text-secondary"
      {...props}
    >
      {children}
    </blockquote>
  );
}
