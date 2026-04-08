import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { reactRouterDevTools } from "react-router-devtools";
import path from "path";

export default defineConfig({
  root: process.env.FLUXY_WORKSPACE ? path.join(process.env.FLUXY_WORKSPACE, "client") : "client",
  resolve: {
    alias: {
      "@": path.resolve("./client/src"),
    },
    // Prevent React dual-instance when workspace/node_modules has its own copy
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.resolve("./dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/app/api": {
        target: "http://localhost:3004",
        rewrite: (path) => path.replace(/^\/app/, ""),
      },
      "/api": "http://localhost:3000",
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
    watch: {
      ignored: [
        "**/app.db*",
        "**/.backend.log",
        "**/files/**",
        "**/.env",
        "**/backend/**",
        "**/*.db",
        "**/*.db-journal",
        "**/*.db-wal",
        "**/*.db-shm",
        "**/*.sqlite",
        "**/*.log",
      ],
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "react-router",
      "driver.js",
      "lucide-react",
      "framer-motion",
      "recharts",
      "zustand",
      "sonner",
      "use-sync-external-store",
      "use-sync-external-store/shim",
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    ...reactRouterDevTools({
      client: {
        routeBoundaryGradient: "watermelon",
      },
      tanstackConfig: {
        triggerHidden: true,
      },
    }),
  ],
});
