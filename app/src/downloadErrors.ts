/** A download failure in words people can act on: a full disk, a corrupt file, a blocked address. Anything else
 * passes through as the engine wrote it. */
export function downloadErrorText(raw: string, t: (key: string) => string): string {
  const text = raw.trim();
  if (/os error 112|not enough space|no space left/i.test(text)) return t("downloadErrorDiskFull");
  if (/os error 5\b|access is denied|permission denied/i.test(text)) return t("downloadErrorAccess");
  if (/checksum mismatch/i.test(text)) return t("downloadErrorChecksum");
  if (/refused by outbound security policy/i.test(text)) return t("downloadErrorRefused");
  return text;
}
