# Recovered images

Drop files into `public/images/` and add one line to `DOC_IMAGES` in
`src/media/imageRegistry.ts`. Nothing else is required — the game probes
for each file at runtime and uses it automatically the moment it exists.

## Categories

Every image belongs to one of four categories. The category decides which
title the popup gets, which layers favour it, and roughly what kind of
"find" it should read as:

| category | reads as | title prefix |
|---|---|---|
| `document` | paper trail — memos, ledgers, letters, microfilm | `RECOVERED ::` |
| `recon` | amateur field photography of the physical plant | `FIELD PHOTO ::` |
| `location` | the building itself — exteriors, lobbies, boardrooms | `SITE RECON ::` |
| `corporate` | the target's own polish — stock photos, reports | `OSINT ::` |

Each layer weights these differently (`imageMix` in `src/sim/layers.ts`):
SURFACE leans `recon`/`location` because you're outside looking in,
INTRANET leans `document` because a corporate LAN is paper, PHYSICAL leans
`location`/`recon` because you are, at that point, at the building.

## Naming

Existing entries are `docs-01.jpg` … `docs-24.jpg` (all `document`). New
entries follow `<category>-<NN>-<slug>.jpg`, e.g. `recon-01-junction-box.jpg`,
`location-02-exterior-stirling.jpg`, `corp-01-meeting-review.jpg`. The
filename is cosmetic — what matters is the `category` and `label` you give
it in the registry.

```ts
{ file: 'recon-15-your-new-photo.jpg', label: 'field photo :: whatever it is', category: 'recon' },
```

## Notes

- Any file that isn't present is simply skipped — the game never errors on
  a missing image, so you can add them one at a time, in any order.
- `.jpg` and `.png` are both accepted for the same slot.
- **Any shape works.** The window measures each image when it loads and
  claims the grid space it needs: tall images get a 1×2 window, wide ones
  get 2×1, roughly-square ones get 1×1. A mixed library is the point — it
  is what puts windows of several sizes on the desktop at once.
- Keep new images close to the existing `docs-*` weight (tens to low
  hundreds of KB, long edge under ~1200px) — they're shown at popup size,
  and heavier files only slow down the page load. `magnific_*`-style
  uploads straight out of a generator tend to be 1-2MB; downscale and
  re-JPEG them before adding.
- Captions are written as **provenance**, not a description of the photo —
  "field photo :: junction box, rear of site", not "a photo of a junction
  box". A caption that doesn't match its image reads as a bug.
- These are copied to `dist/images/` and referenced by relative path, not
  bundled into `index.html` — keep the folder next to it.
- Full-size viewing: any recovered-image popup can be clicked to open it
  full-screen for a few seconds (`src/ui/mediaOverlay.ts`) — the small
  popup is not the only way to see it.
