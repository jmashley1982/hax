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
branch — the live site hadn't updated in over a week. The 17 camera clips
were 15-20× over the project's own size target; re-encoded (80MB → ~2MB),
originals archived. `npm run seed:check` referenced a script that didn't
exist; it now does, and passes.

## Follow-ups from playing it

Three things surfaced only once the thing was live and being played.

**Hosting moved to a Cloudflare Worker** (`hax.jmashley1982.workers.dev`).
The Pages workflow is retired to `archive/pages.yml.superseded` so one push
no longer publishes to two hosts that drift apart. Two traps came with the
move, both silent:

- Wrangler's setup wizard guessed `not_found_handling:
  "single-page-application"`, which answers every unmatched path with a 200
  and the whole ~354kB `index.html`. Both media registries deliberately
  probe for files that may be absent, so that was ~9MB of wasted download
  per page load. Now `"none"`.
- Worse, fixing that in `wrangler.jsonc` *did nothing* at first: wrangler
  was not a dependency, so `npx wrangler deploy` re-ran its wizard and
  generated a competing config that outranked the committed one, with no
  error anywhere. `wrangler` is now a devDependency with a real `npm run
  deploy`, which leaves the wizard nothing to do. Check config changes with
  `npx wrangler dev` before pushing — the live site will not tell you.

**A softlock at KERNEL.** Level 5 spends clear windows on SIGNAL LOCK, but
the depth ladder unlocked `signalAlign` a layer later at PHYSICAL, and the
director drew only from the current layer's pool — the level's required
tools biased picks *within* that pool but were never added to it. The panel
could never appear, and because a levelled run only ends when its objective
is met, the run sat at 0/3 holds forever while the board kept playing.
Fixed by unioning the level's required tools into the spawn pool, so "a
level cannot require a tool it cannot spawn" holds by construction rather
than being true of five specs by luck. `npm run level:check` proves it for
all six layers and fails with exactly this error against the old pool.

## The ending montage

Built (`src/ui/endingMontage.ts`). Every run now ends on four full-bleed
stills crossfading behind the verdict, over ~5s, and **what you see depends
on how you ended**:

- **clean** — the documents you took, then the building you took them from.
- **burned** — *their* photographs of *you*: the junction box you tapped,
  the rooftop dish, the car you sat in. The recon shots the reverse-hack
  beat uses to say "we see you", entered as evidence.

It is not a `showMediaOverlay` — that one is single-instance and dismisses
on any keypress. This is a backdrop that lives and dies with the banner,
mounted inside it at `z-index: -1` so it paints above the scrim and below
the text. It carries its own scanline layer because `.ending-banner` sits
at z-2000, above `.crt-overlay` at z-500, and a bare photograph up there is
the only thing on screen not living behind the CRT.

Two things fell out of building it:

- **The ending didn't know how it ended.** `showEndingBanner` hardcoded the
  headline `'BREACH COMPLETE'` for all four call sites, so losing your
  machine to their incident response, or getting run down by TRACE, ended
  on a screen congratulating you for a successful breach. Headline and tone
  are parameters now — `WORKSTATION OVERRUN`, `THEY FOUND YOU`.
- **The card and the debrief disagreed about time.** The banner removed
  itself at 3800ms while the burned/traced paths handed off at 3600, so
  those endings cut their own card short. Both derive from `ENDING_HOLD_MS`
  now and cannot drift.

INFINITE HACK keeps the short flat card: `rollOverToNextTarget` rebuilds
the board about a second later, so a montage there would play over the next
contract's opening. That also keeps its rng stream unperturbed — endless is
the only mode where a run continues past an ending.

## What's still open

- No shop/economy beyond the raw credits counter.
- The new image categories don't yet feed `src/media/fakeSite.ts`'s
  generated target homepage (a `corporate`/`location` hero image there
  was scoped as a nice-to-have).
