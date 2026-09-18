const fs = require("node:fs");
const path = require("node:path");
const platform = require("./platform.cjs");
const urlPolicy = require("./urlPolicy.cjs");

/** Look for llama-server in user data or on PATH. */
function findLlamaBinary(userDataDir) {
  const binaryName = platform.IS_WINDOWS ? "llama-server.exe" : "llama-server";

  if (userDataDir) {
    const customBin = path.join(userDataDir, "bin", "llama", binaryName);
    if (fs.existsSync(customBin)) return customBin;
  }

  // Check if available on system PATH
  const candidates = platform.IS_WINDOWS
    ? [path.join(process.env.LOCALAPPDATA || "", "Programs", "llama.cpp", binaryName)]
    : ["/usr/local/bin/llama-server", "/usr/bin/llama-server"];

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }

  return null;
}

/** Determines recommended release asset name based on platform and detected GPU. */
function recommendedReleaseAsset(vramGB) {
  if (platform.IS_WINDOWS) {
    if (vramGB > 0) return "llama-server-cuda-x64";
    return "llama-server-vulkan-x64";
  }
  if (platform.IS_MAC) return "llama-server-metal-arm64";
  return "llama-server-vulkan-x64";
}

/** Verifies that a download URL satisfies app outbound URL policy before fetching. */
function validateDownloadUrl(url) {
  return urlPolicy.isFetchableUrl(url, { allowPrivate: false });
}

module.exports = {
  findLlamaBinary,
  recommendedReleaseAsset,
  validateDownloadUrl,
};
