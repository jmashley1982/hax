# Recovered documents

Drop images here as `docs-01` … `docs-24`. They surface in-game as popup
windows framed as files pulled off the target's servers.

## What each slot is meant to be

The captions in `src/media/imageRegistry.ts` are written as provenance, so
each slot has a subject it should match. Slots 13-24 are the mixed-shape
half of the library — the first twelve are all portrait, so these lean
landscape and square to get windows of several sizes on the desktop.

| slot | subject | shape |
|---|---|---|
| 13 | wiped laptop on a desk with termination paperwork | square |
| 14 | site drawings and floor plans unrolled on a table | landscape |
| 15 | spreadsheets and project folders on an office desk | landscape |
| 16 | board correspondence on letterhead, glasses and pen | square |
| 17 | access-control badge roster with an ID card across it | landscape |
| 18 | an empty desk photographed after hours, one lamp | landscape |
| 19 | shipping manifests on a warehouse desk | square |
| 20 | an LTO backup tape and an offsite inventory sheet | portrait |
| 21 | an industrial operations console, screen-lit | landscape |
| 22 | an open personnel file with a photo paperclipped on | square |
| 23 | a contractor handover pack with keys on top | portrait |
| 24 | a whiteboard covered in a hand-drawn network diagram | landscape |

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
