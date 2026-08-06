import { mulberry32 } from '@/core/rng'
import { audio } from './engine'

/**
 * The sound catalogue.
 *
 * Short, dry, 8-bit-adjacent blips rather than cinematic sound design --
 * the game wears a System-7/Win-3.1 face and a lush pad would fight it.
 * Everything here is oscillators and one shared noise buffer.
 *
 * Call sites import `playSfx` directly. Routing these through the store
 * was considered and rejected: EventMap carries no game events at all
 * (panel-cleared, breakthrough and window-open are plain method calls in
 * shell.ts), so a bus route would mean inventing ten event names whose
 * only subscriber is this file -- the same number of edits, plus a layer
 * of indirection. The dependency still points one way; audio imports
 * nothing from the UI.
 */

export type SoundName =
  | 'key'
  | 'winOpen'
  | 'winClose'
  | 'panelClear'
  | 'breakthrough'
  | 'alarm'
  | 'error'
  | 'token'
  | 'powerDown'
  | 'execute'

/**
 * Jitter for the key click, so a mash spree is a texture instead of one
 * sample repeated forty times. Its own stream rather than Math.random,
 * because the project's rule is that every draw comes from core/rng --
 * this one just never needs to line up with anything.
 */
const jitter = mulberry32(0x5eed_c0de)

/**
 * Minimum spacing for the sounds that can arrive in floods.
 *
 * A keystroke is the highest-frequency event in the game, and below ~45ms
 * apart the clicks stop being distinguishable and just sum into a buzz.
 * Window chirps flood differently but just as badly: a breakthrough or a
 * lockout closes the whole board at once, which without this is a dozen
 * chirps in one frame. Extra ones are dropped, not queued -- a queue would
 * play the flood late, which is worse.
 */
const MIN_GAP_MS: Partial<Record<SoundName, number>> = {
  key: 45,
  winOpen: 70,
  winClose: 70,
}

const lastAt = new Map<SoundName, number>()

export function playSfx(name: SoundName): void {
  if (!audio.on) return
  const gap = MIN_GAP_MS[name]
  if (gap !== undefined) {
    const now = performance.now()
    if (now - (lastAt.get(name) ?? -Infinity) < gap) return
    lastAt.set(name, now)
  }
  RECIPES[name]()
}

// -- primitives ------------------------------------------------------------

/**
 * One oscillator with an envelope. `from`/`to` sweep the pitch, which is
 * what turns three identical sine blips into an open, a close and a chime.
 */
function tone(
  type: OscillatorType,
  from: number,
  to: number,
  durS: number,
  peak: number,
  delayS = 0,
): void {
  const slot = audio.acquire()
  if (!slot) return
  const { ctx, dest } = slot
  const t = ctx.currentTime + delayS

  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + durS)

  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, durS * 0.3))
  g.gain.exponentialRampToValueAtTime(0.0001, t + durS)

  osc.connect(g)
  g.connect(dest)
  osc.start(t)
  osc.stop(t + durS + 0.02)
  osc.onended = () => {
    osc.disconnect()
    g.disconnect()
    audio.release()
  }
}

/** A filtered noise burst -- every mechanical sound in here is one of these. */
function burst(centerHz: number, q: number, durS: number, peak: number, delayS = 0): void {
  const slot = audio.acquire()
  if (!slot) return
  const buf = audio.noise()
  if (!buf) {
    audio.release()
    return
  }
  const { ctx, dest } = slot
  const t = ctx.currentTime + delayS

  const src = ctx.createBufferSource()
  src.buffer = buf
  // Start somewhere arbitrary in the buffer so repeats aren't the same
  // 40ms of noise every time.
  const offset = jitter() * (buf.duration - durS - 0.01)

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = centerHz
  bp.Q.value = q

  const g = ctx.createGain()
  g.gain.setValueAtTime(peak, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + durS)

  src.connect(bp)
  bp.connect(g)
  g.connect(dest)
  src.start(t, Math.max(0, offset), durS + 0.02)
  src.onended = () => {
    src.disconnect()
    bp.disconnect()
    g.disconnect()
    audio.release()
  }
}

// -- the catalogue ---------------------------------------------------------

const RECIPES: Record<SoundName, () => void> = {
  /** A key on a stiff mechanical board. Pitch-jittered so it never loops. */
  key: () => burst(1500 + jitter() * 1400, 1.4, 0.03, 0.20),

  winOpen: () => tone('square', 520, 880, 0.07, 0.10),
  winClose: () => tone('square', 700, 380, 0.08, 0.08),

  /** Two notes up: the small, frequent reward. */
  panelClear: () => {
    tone('triangle', 740, 740, 0.09, 0.16)
    tone('triangle', 1108, 1108, 0.16, 0.14, 0.075)
  },

  /** A layer fell. The biggest routine moment in the game. */
  breakthrough: () => {
    tone('triangle', 392, 392, 0.5, 0.16)
    tone('triangle', 523, 523, 0.5, 0.14, 0.09)
    tone('triangle', 784, 784, 0.7, 0.16, 0.18)
    burst(2600, 0.7, 0.5, 0.07, 0.18)
  },

  /** Detuned saw pair, pulsed three times. Waves, reverse hacks, manhunts. */
  alarm: () => {
    for (let i = 0; i < 3; i++) {
      const at = i * 0.22
      tone('sawtooth', 320, 300, 0.16, 0.14, at)
      tone('sawtooth', 327, 306, 0.16, 0.13, at)
    }
  },

  error: () => {
    tone('square', 150, 96, 0.16, 0.16)
    burst(320, 1.0, 0.09, 0.10)
  },

  /** Rising arpeggio + a sparkle on top. Rare enough to be loud. */
  token: () => {
    tone('triangle', 880, 880, 0.08, 0.14)
    tone('triangle', 1174, 1174, 0.08, 0.14, 0.06)
    tone('triangle', 1568, 1568, 0.22, 0.16, 0.12)
    burst(5200, 1.2, 0.2, 0.05, 0.12)
  },

  /** Their hand on the switch: a long pitch collapse and a noise tail. */
  powerDown: () => {
    tone('sawtooth', 420, 32, 0.95, 0.18)
    tone('sine', 210, 24, 1.1, 0.14, 0.05)
    burst(180, 0.6, 0.7, 0.09, 0.3)
  },

  /** He is plugged in. GO. */
  execute: () => {
    tone('sawtooth', 180, 260, 0.22, 0.18)
    burst(900, 0.9, 0.14, 0.16)
  },
}
