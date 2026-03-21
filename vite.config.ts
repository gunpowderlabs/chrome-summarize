import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, cpSync, existsSync } from "fs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-extension-files",
      closeBundle() {
        const files = [
          "background.js",
          "content.js",
          "manifest.json",
          "options.html",
          "options.js",
          "prompt.txt",
        ];
        for (const file of files) {
          const src = resolve(__dirname, file);
          if (existsSync(src)) {
            copyFileSync(src, resolve(__dirname, "dist", file));
          }
        }
        const dirs = ["icons", "native-host"];
        for (const dir of dirs) {
          const src = resolve(__dirname, dir);
          if (existsSync(src)) {
            cpSync(src, resolve(__dirname, "dist", dir), { recursive: true });
          }
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
      },
    },
  },
});
