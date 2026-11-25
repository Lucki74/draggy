/** Fills `{name}` placeholders in a translated sentence. Values are plain text, since bidi isolate marks
 * would show as boxes in the UI. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
