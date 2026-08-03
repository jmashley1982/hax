import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { viteSingleFile } from 'vite-plugin-singlefile'

// NULLSTACK build config.
//
// base: './' so the production build works when opened directly from disk
// (file://) or from a USB stick with no web server — a hard requirement for
// using this as an offline film prop.
//
// viteSingleFile inlines the JS/CSS bundle directly into index.html as a
// classic (non-module) script. This matters beyond convenience: Chromium
// refuses to load `<script type="module">` from file:// at all (module
// fetches are blocked by local-file CORS rules), so without this plugin the
// "open dist/index.html straight from a USB stick" requirement would
// silently fail in the most common browser. Video files stay external
// (referenced by relative path from public/video/, never inlined) so the
// build doesn't balloon into base64'd media.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    sourcemap: false, // sourcemaps don't survive/matter once everything is inlined
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
  server: {
    port: 5173,
  },
})
