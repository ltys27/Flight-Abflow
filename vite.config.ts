import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "Flow Scripts",
        short_name: "Flow Scripts",
        description: "Offline study of PF/PM flow scripts with annotations and drills.",
        display: "standalone",
        start_url: "./",
        scope: "./",
        background_color: "#111318",
        theme_color: "#111318",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the app shell and every file in /procedures (spec 9).
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
        navigateFallback: "index.html",
        // Control the page on first install so a single visit is enough for an offline cold start.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
