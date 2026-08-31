import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.js"],
    reporters: ["default"],
    coverage: {
      // The logic-heavy modules the suite is actually aimed at. Screens and
      // workers are left out: they are driven by Electron and a GPU, not by
      // anything a coverage number here would mean.
      include: [
        "src/agent/*.ts",
        "src/embedModel.ts",
        "src/fileList.ts",
        "src/greetings.ts",
        "src/modelKinds.ts",
        "src/modelRecommendations.ts",
        "src/ollama.ts",
        "src/storage.ts",
        "src/toolParsing.ts",
        "src/tools/registry.ts",
        "src/utils.ts",
        "src/voice/*.ts",
        "src/vram.ts",
        "electron/documents.cjs",
        "electron/favicon.cjs",
        "electron/library.cjs",
        "electron/search.cjs",
        "electron/storage.cjs",
      ],
    },
  },
});
