# NULLSTACK

A browser-based elite-hacker simulator. Two things at once, on purpose:

- **A toy.** Mash the keyboard and feel like you are breaking into
  something. Nothing is really hacked; it is entirely theatre.
- **A film prop.** Put it on a monitor in a scene and shoot it. It has a
  chrome-free mode, adjustable pacing, cued beats, an unattended autopilot,
  and deterministic playback so takes match.

Play it at **https://jmashley1982.github.io/hax/**

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # -> dist/  (typechecks first; a type error fails the build)
npm run preview
```

The build is a **single self-contained `index.html`** with all JS and CSS
inlined. It works opened straight off disk (`file://`), off a USB stick, or
behind any static host. It makes **zero external network requests** and has
**zero runtime dependencies** — only `vite` and `typescript` at build time.
That is deliberate: a prop has to still work in five years on a machine
with no internet.

Media (`public/images/`, `public/video/`) is the one exception — it stays
as loose files next to `index.html` rather than being inlined, so you can
add to it without rebuilding. Keep the folders next to the HTML.

```bash
npm run typecheck      # both tsconfigs
npm run content:audit  # samples 50k generated lines, reports the duplicate rate
npm run seed:check     # runs the same seed twice and diffs the output
```

---

## Playing

Pick a contract on the dashboard and JACK IN. Then: **type**. Every
keystroke drives whichever window is targeted, and an unused keystroke
rolls on to the next window that can use it, so mashing is never wasted.
Click a window to aim at it deliberately.

| | |
|---|---|
| **INFINITE HACK** | Never ends. Crossing the deepest layer rolls straight into a fresh target. No objectives, no gates — the fidget-toy mode. ESC or refresh to stop. |
| **CASUAL HACK** | The game. Six depth layers, each with its own objective and its own required tool, plus blocking gates that stop the world until you deal with them. Scored, with an arcade high-score wall. |
| **DEEP HACK** | Coming soon. |

Failing a gate costs you — integrity, heat, and ground on the objective —
but it never ends the run.

Watch the **RELAY :: CONTACTS** panel. Most of the chatter is nothing. Some
of it is a contact handing you the session key for a lock you have not hit
yet, and when that happens the lock opens in one click instead of twelve
frantic seconds. That is the one message type worth reading every time.

**ESC** aborts a contract you have lost control of. Your career score is
kept.

---

## Using it as a prop

### Film mode

Press **F9**, or set `FILM` to ON in the dashboard settings (it persists).

Film mode hides everything that reads as a *game* and keeps everything that
reads as a *hack*. Gone: the OBJECTIVE label and its "click the open ports"
hint, the ABORT button, the `MODE / THEME / SEED` footer, the unread pip.
Kept: every window, the terminal, the contact list, the meters, the camera
feeds, the target readout, and the job line — because
`MAP HALCYON DYNAMICS -- 2/3 live hosts found` is exactly the kind of text
a shot wants.

It also drops the pacing to **0.6×**. Default pacing is tuned for someone
driving it; on camera that reads as frantic. Only the simulation slows —
glitches and scanlines run at full speed.

| key | what it does |
|---|---|
| **F9** | Toggle film mode |
| **F10** | Force the next depth layer *now* — land the breakthrough on the line |
| **F8** | Toggle autopilot |

These are function keys specifically so they can never be confused with
mashing, and they work even while a blocking gate is up.

### Autopilot

**F8** hands the keyboard to the machine: it types at a human cadence,
clicks live widgets, and works its way down through the layers with nobody
at the desk. Use it to run a monitor unattended through a take, or to demo
the thing without visibly driving it.

It only types and works panels. It will never close your windows, abort the
contract, or spend a token — an unattended driver that could wreck the take
it exists to record would be worse than useless.

### Matching takes

Every random draw in the game comes from one seeded generator. Same seed,
same run — same contracts on the board, same panels, same popups, same
gates at the same points.

```
index.html?seed=coldharbor
```

The seed is shown in the bottom-right footer during a session (film mode
hides it — read it before you switch over, or set it in the URL). Reload
with the same `?seed=` and the run repeats. `npm run seed:check` is the
regression test that proves it.

With no `?seed=`, the seed is stable *per calendar day*, so an ordinary
session still feels fresh without being genuinely unrepeatable.

### Themes

Four palettes — `phosphor`, `amber`, `neon`, `agency` — cycled from the
dashboard. The palette shifts again with depth, so the six layers are six
different-looking places within whichever theme you picked. Theme and depth
compose; they do not fight.

---

## Adding your own media

### Images

Drop files into `public/images/` as `docs-01` … `docs-24`, `.jpg` or
`.png`. They surface in-game as popup windows framed as documents pulled
off the target's servers.

Missing slots are skipped silently — add them one at a time, in any order.
**Any shape works:** each image is measured when it loads and claims the
window it needs (tall → 1×2, wide → 2×1, square → 1×1). A mixed library is
the point; it is what puts windows of several sizes on the desktop at once.

Captions are in `src/media/imageRegistry.ts`. They are written as
provenance ("recovered from a wiped laptop"), so a caption that does not
match its image reads as a bug.

### Video

Drop clips into `public/video/`. Camera windows use them for CCTV feeds and
public-livestream framings. Where no clip fits, the game renders synthetic
footage on a canvas instead — so the camera beats work with an empty
folder, and get better as you fill it. See `public/video/manifest.json`.

---

## How it is built

Vanilla TypeScript and Vite. No UI framework: this is ~90% imperative
animation — streaming text, canvas noise, glitch passes, draggable windows,
a 60fps tick loop — and a virtual DOM would be constant friction against
all of it.

```
src/
  core/      rng (seeded), store, clock, input, state, progress, high scores
  content/   template grammar + authored banks -> the anti-repetition engine
  sim/       layers, levels, contracts, heat, integrity, threats, director
  ui/        shell, desktop regions, windows, task panels, HUD, dashboard
  media/     image + video registries, entity graph, street map
  audio/     Web Audio synthesis (no audio files)
  film/      film mode + autopilot
  fx/        CRT, glitch, noise, transitions
```

Two rules the codebase actually enforces:

1. **No bare `Math.random()`.** Every draw goes through `core/rng.ts` so
   `?seed=` reproduces a run exactly. Breaking this breaks the prop.
2. **Nothing leaves the machine.** No fetches, no analytics, no fonts, no
   CDNs. High scores are in `localStorage`, like an arcade cabinet.

---

## Deploying

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages
on every push to the default branch. Nothing else is required — `base` is
already relative, so it works at a subpath, at a domain root, or from a
folder on a stick.
