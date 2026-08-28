import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";

// onnxruntime-web ships as a nested dependency of transformers.js when another
// copy is hoisted to the root, so look in both places and use whichever exists.
// The glue .mjs and the .wasm must come from the same install or the runtime
// aborts on a version check.
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

export default defineConfig({
  plugins: [react(), onnxRuntimeAssets()],
  base: "./",
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
