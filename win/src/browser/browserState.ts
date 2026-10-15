/** What main reports about the page under a browser bar. */
export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  adblock: boolean;
}

export const EMPTY_BROWSER_STATE: BrowserState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  adblock: true,
};
