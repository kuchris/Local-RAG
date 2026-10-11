import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// `npm run dev:ui` proxies /api to a standalone backend (see README → Development).
const backend = process.env.LOCAL_RAG_BACKEND || "http://127.0.0.1:8765";
const token = process.env.LOCAL_RAG_TOKEN || "dev";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "dist", emptyOutDir: true, target: "chrome140", chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
        configure: (proxy) =>
          proxy.on("proxyReq", (request) => {
            request.removeHeader("origin");
            request.setHeader("Authorization", `Bearer ${token}`);
          }),
      },
    },
  },
});
