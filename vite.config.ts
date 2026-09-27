import { defineConfig } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/media": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  build: { outDir: "dist" },
});
