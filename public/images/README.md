# Recovered documents

Drop images here as `docs-01` … `docs-24`. They surface in-game as popup
windows framed as files pulled off the target's servers.

- Any file that isn't present is simply skipped — the game never errors on
  a missing image, so you can add them one at a time, in any order.
- `.jpg` and `.png` are both accepted for the same slot number.
- **Any shape works.** The window measures each image when it loads and
  claims the grid space it needs: tall images get a 1×2 window, wide ones
  get 2×1, roughly-square ones get 1×1. Nothing to declare, and a mixed
  library is the point — it is what puts windows of several sizes on the
  desktop at once.
- Captions live in `src/media/imageRegistry.ts` if you want to re-word one.
  They are written as provenance ("recovered from a wiped laptop"), so a
  caption that doesn't match its image reads as a bug.
- These are copied to `dist/images/` and referenced by relative path, not
  bundled into `index.html` — keep the folder next to it.
