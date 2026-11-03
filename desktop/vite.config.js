import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The renderer builds to dist/. main.js loads dist/index.html from disk, so paths are relative.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
