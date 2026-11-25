import { uiLocale } from "./i18n";

/** File and download sizes, decimal like Hugging Face and the OS: 1 GB = 1e9 bytes, 1 MB = 1e6. */
export const GB = 1e9;
export const MB = 1e6;

/** Bytes as people read a download: KB below a megabyte, MB below a gigabyte, GB above. Empty for an unknown size. */
export function formatBytes(bytes: number, language = uiLocale(), gbDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  // 999.6 MB rounds to 1000 MB, which reads better as 1.0 GB.
  if (bytes >= GB || Math.round(bytes / MB) >= 1000) {
    const number = new Intl.NumberFormat(language, { minimumFractionDigits: gbDigits, maximumFractionDigits: gbDigits });
    return `${number.format(bytes / GB)} GB`;
  }
  return `${Math.round(bytes / MB)} MB`;
}

/** A "done / total" pair in one unit, so "0.9 / 4.6 GB" never reads "900 MB / 4.6 GB". */
export function formatTransferred(completed: number, total: number, language = uiLocale()): string {
  const gigabytes = total >= GB;
  const scale = gigabytes ? GB : MB;
  const digits = gigabytes ? 2 : 0;
  const number = new Intl.NumberFormat(language, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${number.format(Math.max(0, completed) / scale)} / ${number.format(total / scale)} ${gigabytes ? "GB" : "MB"}`;
}
