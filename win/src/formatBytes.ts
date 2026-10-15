/** File and download sizes, decimal like Hugging Face and the OS: 1 GB = 1e9 bytes, 1 MB = 1e6. */
export const GB = 1e9;
export const MB = 1e6;

/** Bytes as people read a download: MB below a gigabyte, GB above. Empty for an unknown size. */
export function formatBytes(bytes: number, language = "en", gbDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= GB) {
    const number = new Intl.NumberFormat(language, { minimumFractionDigits: gbDigits, maximumFractionDigits: gbDigits });
    return `${number.format(bytes / GB)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

/** A "done / total" pair in one unit, so "0.9 / 4.6 GB" never reads "900 MB / 4.6 GB". */
export function formatTransferred(completed: number, total: number, language = "en"): string {
  const gigabytes = total >= GB;
  const scale = gigabytes ? GB : MB;
  const digits = gigabytes ? 2 : 0;
  const number = new Intl.NumberFormat(language, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${number.format(Math.max(0, completed) / scale)} / ${number.format(total / scale)} ${gigabytes ? "GB" : "MB"}`;
}
