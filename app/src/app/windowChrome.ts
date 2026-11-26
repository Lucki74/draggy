/** On macOS the system draws the traffic lights over the title bar's left end, so the page draws no caption buttons. */
export const NATIVE_CONTROLS = typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent);
/** The title bar's start padding: room for the traffic lights on macOS. */
export const TITLE_BAR_START = NATIVE_CONTROLS ? "ps-[78px]" : "ps-3";
/** The title bar's end padding: room for the caption buttons where the page draws them. */
export const TITLE_BAR_END = NATIVE_CONTROLS ? "pe-3" : "pe-[140px]";
