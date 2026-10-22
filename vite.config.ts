// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { CURRENT } from "./src/notes/changelog";

// Build stamp shown in the Notes app's About sheet.
const BUILD = new Date().toISOString().replace(/\D/g, "").slice(0, 14);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // The Notes app runs on the device only (ClientOnly), so its one page is prerendered at build time: .output/public
    // gets a static index.html any static host (Hostinger) can serve as is; the Worker keeps serving Lovable's hosting.
    prerender: { enabled: true, crawlLinks: false },
    pages: [{ path: "/" }],
  },
  vite: {
    // The installed version comes from the changelog at build time, so the app never loads the changelog to know it.
    define: { __BUILD__: JSON.stringify(BUILD), __VERSION__: JSON.stringify(CURRENT.version) },
  },
});
