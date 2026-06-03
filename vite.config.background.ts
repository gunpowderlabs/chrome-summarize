import { defineConfig } from "vite";
import { resolve } from "path";

// The service worker is bundled on its own so the AI SDK can be inlined into a
// single self-contained file — MV3 service workers can't resolve npm deps at
// runtime. The side panel build (vite.config.ts) runs first and emits every
// other static file, so this build must not empty the output directory.
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "esnext",
    // A single lib entry inlines dynamic imports into one self-contained file.
    lib: {
      entry: resolve(__dirname, "background.js"),
      formats: ["es"],
      fileName: () => "background.js",
    },
  },
});
