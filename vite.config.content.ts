import { defineConfig } from "vite";
import { resolve } from "path";

// The content script is bundled on its own so Defuddle can be inlined — MV3
// content scripts are classic scripts and can't resolve npm deps at runtime,
// so the output must be a single self-contained IIFE. The side panel build
// (vite.config.ts) runs first and emits every other static file, so this
// build must not empty the output directory.
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "esnext",
    lib: {
      entry: resolve(__dirname, "content.js"),
      formats: ["iife"],
      name: "contentScript",
      fileName: () => "content.js",
    },
  },
});
