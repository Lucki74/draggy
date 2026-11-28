import { useState } from "react";
import { readLintConfig, type CheckCommand, type ProjectLintConfig } from "../agent/lintLoop";
import { useProjectChecks } from "../app/useProjectChecks";
import { Button, ConfirmDialog, Group, Row, Toggle } from "./Controls";
import type { Workspace } from "../types";

type Translate = (key: string) => string;

interface LintChecksSectionProps {
  project: Workspace;
  onSave: (config: ProjectLintConfig) => void;
  t: Translate;
}

function sameCommands(a: CheckCommand[], b: CheckCommand[]): boolean {
  return a.length === b.length && a.every((check, index) => check.command === b[index].command && (check.body ?? "") === (b[index].body ?? ""));
}

/** Checks after edits for one project. Turning them on needs confirming the exact commands listed. */
export default function LintChecksSection({ project, onSave, t }: LintChecksSectionProps) {
  const detect = useProjectChecks(project);
  const [confirming, setConfirming] = useState(false);
  const config = readLintConfig(project.settings?.lintLoop) ?? { enabled: false, confirmed: [] };

  if (!project.rootPath) {
    return (
      <Group title={t("checksAfterEdits")}>
        <Row label={t("checksNoFolder")} />
      </Group>
    );
  }

  const ready = detect.status === "ready" && detect.checks.length > 0;
  const matches = ready && sameCommands(config.confirmed, detect.checks);
  const active = config.enabled && matches;
  const changed = config.enabled && ready && !matches;

  const description =
    detect.status === "loading"
      ? t("checksLoading")
      : detect.status === "ready" && detect.checks.length === 0
        ? t("checksEmpty")
        : t("checksHint");

  const toggle = (on: boolean) => {
    if (!on) {
      onSave({ enabled: false, confirmed: config.confirmed });
    } else if (matches) {
      onSave({ enabled: true, confirmed: config.confirmed });
    } else {
      setConfirming(true);
    }
  };

  return (
    <Group title={t("checksAfterEdits")}>
      <Row label={t("checksToggle")} description={description}>
        <Toggle
          label={t("checksToggle")}
          checked={active}
          disabled={!ready}
          onChange={toggle}
        />
      </Row>
      {detect.status === "error" && (
        <Row label={t("checksError")}>
          <Button onClick={detect.retry}>{t("checksRetry")}</Button>
        </Row>
      )}
      {changed && <Row label={t("checksChanged")} />}
      {ready && (
        <Row label={t("checksCommands")} description={detect.checks.map((c) => <code key={c.command} className="block break-all">{c.command}</code>)} />
      )}
      {confirming && (
        <ConfirmDialog
          title={t("checksConfirmTitle")}
          body={`${t("checksConfirmBody")} ${detect.checks.map((c) => `${c.command} (${c.body ?? ""})`).join(" · ")}`}
          confirmLabel={t("checksConfirm")}
          cancelLabel={t("cancel")}
          tone="primary"
          onConfirm={() => {
            setConfirming(false);
            onSave({ enabled: true, confirmed: detect.checks });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Group>
  );
}
