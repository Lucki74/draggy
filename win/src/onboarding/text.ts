/** Fills `{name}` placeholders in a translated sentence. Each value is isolated, so "12 GB" or a path
 * keeps its own order inside an Arabic sentence; the marks are invisible elsewhere. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => `⁨${values[key] ?? ""}⁩`);
}
