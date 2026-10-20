import { defineConfig, type HtmlTagDescriptor } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Independent, signed-out local entry; shared UI primitives and design tokens.
export default defineConfig({
  base: "./",
  publicDir: "writing-public",
  plugins: [tailwindcss(), react(), {
    name: "writing-production-csp",
    apply: "build",
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [{ tag: "meta", injectTo: "head-prepend", attrs: {
        "http-equiv": "Content-Security-Policy",
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* http://[::1]:* https:; object-src 'none'; frame-src 'none'; base-uri 'self'",
      } }];
    },
  }],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
  preview: { host: "127.0.0.1", port: 5188, strictPort: true },
  build: {
    outDir: "dist-writing",
    rollupOptions: {
      input: fileURLToPath(new URL("./writing.html", import.meta.url)),
    },
  },
});
