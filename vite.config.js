import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/nisar-pulse/" : "/",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
