/** What main reports about the page under a browser bar. */
export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  adblock: boolean;
  /** Why the last load failed, or null while it loads or after it succeeds. */
  error?: string | null;
}

export const EMPTY_BROWSER_STATE: BrowserState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  adblock: true,
  error: null,
};
