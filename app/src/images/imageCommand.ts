/** A file name from a prompt, the same way the main process names one in the output folder. */
export function slugFor(prompt: string): string {
  const words = String(prompt || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 40) break;
    slug = next;
  }
  return slug || "image";
}

/** Where an image goes in a project when nobody said where. */
export function defaultProjectPath(prompt: string): string {
  return `assets/generated/${slugFor(prompt)}.png`;
}
