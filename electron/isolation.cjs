/** Cross-origin isolation, so ONNX Runtime Web may use WASM threads. These are response headers, not
 * CSP, so the main window's policy is untouched. `credentialless` rather than `require-corp`: remote
 * images and fonts the chat embeds keep loading, only without cookies. */
const DOCUMENT_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

/** Files the isolated page fetches from another of the app's own schemes (models, widgets, assets). */
const RESOURCE_HEADERS = {
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

module.exports = { DOCUMENT_HEADERS, RESOURCE_HEADERS };
