import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3010,
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5000",
        changeOrigin: true,
        xfwd: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/cshis": {
        target: "https://127.0.0.1:5066",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/cshis/, ""),
      },
    },
  },
});
