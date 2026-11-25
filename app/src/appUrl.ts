/**
 * URL for a `draggy` scheme resource. WebView2 maps the scheme to http://draggy.localhost, so Tauri on
 * Windows needs that form; Electron and other hosts use the bare `draggy://` scheme.
 */
export function draggyUrl(path: string): string {
  const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  return tauri && windows ? `http://draggy.localhost/${path}` : `draggy://${path}`;
}
