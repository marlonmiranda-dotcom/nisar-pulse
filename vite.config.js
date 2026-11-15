import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

// cesium() copia los workers del globo y, al compilar, deja Cesium.js aparte.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/nisar-pulse/" : "/",
  plugins: [react(), cesium()],
  build: { chunkSizeWarningLimit: 2500 },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
