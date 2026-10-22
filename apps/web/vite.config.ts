import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    // `/auth?token=…` (from `temper open`) sets the board cookie, so it goes to the server too.
    proxy: Object.fromEntries(
      ["/api", "/auth"].map((path) => [path, { target: process.env.TEMPER_API_URL ?? "http://127.0.0.1:4600", changeOrigin: true }]),
    ),
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
