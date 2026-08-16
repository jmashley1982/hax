# Media prominence and the danger arc — 2026-08-16

## Why

The game was a working concept with two problems: 31 newly uploaded images
sat completely unused (a hardcoded 24-slot table only knew the old
filenames), and the systems underneath — heat, integrity, gates, waves,
manhunts — never resolved into a felt arc. Heat decays. Integrity
regenerates. Nothing in a run *persisted* consequence, so a long clean
stretch and a run full of near-misses ended up feeling about the same.
Media was also never shown large: every image and video topped out at a
few hundred pixels, ambient texture among a dozen popups.

This pass: make the new images mean something, put the best of them on
screen full-size at the moments that earn it, and give the run a meter
that actually remembers how it's going.

## What changed

**Image library, categorized.** `src/media/imageRegistry.ts`'s `DOC_IMAGES`
now carries a `category` per entry: `document`, `recon`, `location`,
`corporate`. Each depth layer (`src/sim/layers.ts`) weights the four
differently — SURFACE leans `recon`/`location` (outside looking in),
INTRANET leans `document` (a corporate LAN is paper), PHYSICAL leans
`location`/`recon` (you're at the building). The 31 new images were
compressed (~39MB → ~1.8MB, matching the existing library's weight),
renamed by subject, and slotted into all four categories; the originals
moved to `/archive/images-originals/` rather than being deleted.

**A full-screen beat, not just another popup.** `src/ui/mediaOverlay.ts`
is a new, deliberately non-window surface — it never touches
`WindowManager` or the board's window budget, and unlike a gate it never
captures the keyboard, so a keystroke that dismisses it still reaches
gameplay on the same frame. It fires at: the contract's objective file
being located, occasionally on an ambient document draw once tension is
high, the boot sequence's target dossier, and any recovered-image popup
you click on.

**TRACE — the meter that doesn't forgive.** `src/sim/trace.ts`. Heat is
weather (rises with noise, decays every second). Integrity is the
counterweight (falls from mistakes, regenerates in clean play). TRACE is
neither: it only rises — from failed gates, lost waves, lockouts, a
landed reverse hack — and only falls from something actually earned (a
breakthrough, a won manhunt, a spent TROJAN BYPASS). At 100 the run ends —
in CASUAL and DEEP alike, by explicit direction ("deadly everywhere").
INFINITE HACK has no ending to reach, so it burns the box and rolls onto a
fresh target instead, same shape as every other endless-mode setback.

**DEEP HACK, enabled.** `src/core/progress.ts`. The mode existed as
disabled coefficients for a while — `idleDrainPerSec` (standing still
costs you) had nothing to differentiate it further. Two more coefficients
finish the job: `traceRate` (1.6× versus CASUAL's 1×) and `scoreMul` (2×
career payout). No new systems, same shape as the other two modes.

**Combo.** Consecutive clean panel clears multiply score up to ×3 (streak
of 8). Breaks on any hostile damage, a failed gate, or a lockout — the
same event list `INTEGRITY_COST` already names, not a second definition of
"something went wrong."

**Credits.** `state.credits`, additive to the save format. Every debrief
payout banks into it (scaled by DEEP HACK's `scoreMul`), shown on the
dashboard next to career score. No shop, no upgrades — that's future
scope; this is the number the "gotta pay the bills" framing needed to be
real.

**Housekeeping.** The Pages workflow was deploying from a stale side
branch — the live site hadn't updated in over a week. Now watches `main`.
The 17 camera clips were 15-20× over the project's own size target;
re-encoded (80MB → ~2MB), originals archived. `npm run seed:check`
referenced a script that didn't exist; it now does, and passes.

## What's still open

- Finale montage (cycling location/recon images behind the ending banner)
  — designed, not built; lowest-priority item in the original plan.
- No shop/economy beyond the raw credits counter.
- The new image categories don't yet feed `src/media/fakeSite.ts`'s
  generated target homepage (a `corporate`/`location` hero image there
  was scoped as a nice-to-have).
