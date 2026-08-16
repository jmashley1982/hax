# Camera clips

Drop your clips in this folder. Nothing else is required — the game probes
for each file at runtime and uses it automatically the moment it exists.

## Naming

The expected filenames and their burned-in camera labels live in
`src/media/videoRegistry.ts` (`FEED_CLIPS`). Out of the box it expects:

    cam-01.mp4 … cam-20.mp4

Rename them there if you'd rather use your own filenames — that list is the
only source of truth, and nothing else in the code needs to change.

## Format

- **MP4 (H.264 + AAC or no audio)** is the safest choice; it plays
  everywhere including from `file://`.
- Clips are played **muted, looped and inline**, so audio is ignored.
- Roughly **5 seconds** is ideal — popups live for 7–13 seconds, so a short
  loop reads as a live feed rather than a clip that ends.
- Small is good. These are shown in a ~260×150 window, so anything above
  ~720p is wasted bytes. A few hundred KB each keeps the whole build light
  — the current 17 clips average well under 200KB (640px wide, crf 30, no
  audio track) after being re-encoded from much heavier camera-app
  originals, which are kept in `/archive/video-originals/` per the
  no-delete rule rather than thrown away.

## Missing files are fine

Any clip that isn't present falls back to a canvas-rendered synthetic feed
(`src/media/syntheticFeed.ts`) with the same chrome — timecode, REC dot,
camera ID, scanlines, dropouts. That means the game is fully playable with
this folder empty, and every file you add just upgrades one more feed.

## A note on the build

These files are **not** bundled into `index.html` (see `vite.config.ts`) —
they're copied to `dist/video/` and referenced by relative path. Keep the
folder next to `index.html` when copying the build somewhere.
