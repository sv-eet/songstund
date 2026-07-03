import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // During `npm run dev`, forward API + WS traffic to `wrangler dev`.
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true },
    },
  },
});
