# Recovered documents

Drop images here as `docs-01.png` … `docs-09.png`. They surface in-game as
popup windows framed as files pulled off the target's servers.

- Any file that isn't present is simply skipped — the game never errors on
  a missing image, so you can add them one at a time.
- `.png` is expected; `.jpg` is also accepted for the same slot number.
- Labels and filenames live in `src/media/imageRegistry.ts` if you want to
  rename or re-caption them.
- These are copied to `dist/images/` and referenced by relative path, not
  bundled into `index.html` — keep the folder next to it.
