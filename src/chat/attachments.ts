/**
 * What to do with a dropped file. The rules need no FileReader, so they live
 * here and are tested; the order of the checks is the part that goes wrong.
 */

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

export const DOCUMENT_EXTENSIONS = ["docx", "pptx", "xlsx", "pdf"];

export const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonc",
  "yaml", "yml", "xml", "toml", "ini", "cfg", "conf", "env", "properties",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "html", "htm", "css", "scss",
  "sass", "less", "vue", "svelte", "astro", "svg",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cpp",
  "cc", "hpp", "cs", "php", "lua", "r", "pl", "dart", "scala", "clj", "ex",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "graphql",
  "gradle", "dockerfile", "makefile", "gitignore", "editorconfig",
];

/** Every extension the picker offers, images aside. */
export const ACCEPTED_EXTENSIONS = [...DOCUMENT_EXTENSIONS, ...TEXT_EXTENSIONS];

export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type AttachmentKind = "image" | "document" | "text";

export type AttachmentPlan =
  | { kind: AttachmentKind; extension: string }
  /** `reason` is a translation key, not a sentence. */
  | { kind: "reject"; reason: string };

export interface FileFacts {
  name: string;
  size: number;
  type: string;
}

export function extensionOf(name: string): string {
  const parts = String(name).split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function looksLikeImage(file: FileFacts): boolean {
  return (
    String(file.type || "").startsWith("image/") ||
    IMAGE_EXTENSIONS.includes(extensionOf(file.name))
  );
}

/**
 * What happens to this file, before anything is read. Reasons are translation
 * keys: a plan carrying English is a bug only somebody else would see.
 */
export function planAttachment(
  file: FileFacts,
  options: { visionSupported: boolean },
): AttachmentPlan {
  const extension = extensionOf(file.name);

  if (looksLikeImage(file)) {
    // Refused before the size check: telling someone their photo is too large
    // when the model could not have read it at any size is a worse message.
    if (!options.visionSupported) return { kind: "reject", reason: "visionUnsupported" };
    if (file.size > MAX_IMAGE_BYTES) return { kind: "reject", reason: "fileTooLarge" };
    return { kind: "image", extension };
  }

  if (DOCUMENT_EXTENSIONS.includes(extension)) {
    if (file.size > MAX_DOCUMENT_BYTES) return { kind: "reject", reason: "fileTooLarge" };
    return { kind: "document", extension };
  }

  if (!TEXT_EXTENSIONS.includes(extension)) {
    return { kind: "reject", reason: "unsupportedFile" };
  }

  if (file.size > MAX_TEXT_FILE_BYTES) return { kind: "reject", reason: "fileTooLarge" };

  return { kind: "text", extension };
}
