/** Fills `{name}` placeholders in a translated sentence, so each language keeps its own word order. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
