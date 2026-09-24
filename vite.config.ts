import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { loadRnnoiseWasm } from "./scripts/rnnoiseWasm";

// onnxruntime-web may be nested under transformers.js or hoisted, so check both. The .mjs glue and
// .wasm must come from one install or it aborts.
const ORT_CANDIDATES = [
  "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist",
  "node_modules/onnxruntime-web/dist",
];

const ORT_DIR = path.resolve(
  ORT_CANDIDATES.find((candidate) => existsSync(path.resolve(candidate))) ??
    ORT_CANDIDATES[0],
);

const ORT_FILES = existsSync(ORT_DIR)
  ? readdirSync(ORT_DIR).filter((name) => /^ort-wasm.*[.](wasm|mjs)$/.test(name))
  : [];

if (ORT_FILES.length === 0) {
  throw new Error(
    `Could not find the onnxruntime-web assets. Looked in: ${ORT_CANDIDATES.join(", ")}`,
  );
}

function onnxRuntimeAssets(): PluginOption {
  return {
    name: "onnx-runtime-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/ort\/([\w.-]+)$/);
        const name = match?.[1];
        if (!name || !ORT_FILES.includes(name)) return next();

        const file = path.join(ORT_DIR, name);
        if (!existsSync(file)) return next();

        res.setHeader(
          "Content-Type",
          name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) {
        const file = path.join(ORT_DIR, name);
        if (!existsSync(file)) continue;
        this.emitFile({
          type: "asset",
          fileName: `ort/${name}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

/** RNNoise for the microphone, served and emitted as rnnoise/rnnoise.wasm beside the app. */
function rnnoiseAsset(): PluginOption {
  const fileName = "rnnoise/rnnoise.wasm";
  return {
    name: "rnnoise-asset",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== `/${fileName}`) return next();
        res.setHeader("Content-Type", "application/wasm");
        res.end(loadRnnoiseWasm());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName, source: loadRnnoiseWasm() });
    },
  };
}

export default defineConfig({
  plugins: [react(), onnxRuntimeAssets(), rnnoiseAsset()],
  base: "./",
  optimizeDeps: {
    /** Speech deps load only via dynamic imports in workers, which the crawler misses. Found late,
     * Vite re-hashes URLs and breaks running workers, so name them. */
    include: ["onnxruntime-web", "@huggingface/transformers", "kokoro-js"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return "react";
          if (/framer-motion|motion-dom|motion-utils/.test(id)) return "motion";
          if (/onnxruntime|@huggingface/.test(id)) return "speech";
          if (
            /react-markdown|remark-|rehype-|micromark|mdast|hast|unist|katex|character-entities|property-information|space-separated-tokens|comma-separated-tokens|parse-entities/.test(
              id,
            )
          )
            return "markdown";
        },
      },
    },
  },
});
