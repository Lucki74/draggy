import { Group, Row, Select } from "../../settings/Controls";
import { languages } from "../../translations";
import StepHeader from "./StepHeader";

export default function Welcome({
  language,
  onLanguage,
  t,
}: {
  language: string;
  onLanguage: (language: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-8">
      <StepHeader title={t("onbWelcomeTitle")} body={t("onbWelcomeBody")} />
      <Group>
        <Row label={t("language")}>
          <Select
            label={t("language")}
            value={language}
            options={languages.map((entry) => ({ id: entry.code, label: entry.name }))}
            onChange={onLanguage}
          />
        </Row>
      </Group>
    </div>
  );
}
