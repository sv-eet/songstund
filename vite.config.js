import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Served from https://sv-eet.github.io/songstund/
  base: "/songstund/",
  plugins: [react()],
});
