import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.js"],
    reporters: ["default"],
    coverage: {
      include: [
        "src/toolParsing.ts",
        "src/vram.ts",
        "src/ollama.ts",
        "src/router.ts",
        "src/voice.ts",
        "src/storage.ts",
        "src/tools/registry.ts",
        "electron/documents.cjs",
        "electron/library.cjs",
        "electron/search.cjs",
        "electron/storage.cjs",
      ],
    },
  },
});
