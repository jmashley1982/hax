/**
 * The audio bus.
 *
 * "i never hear any sounds ever when playing." There was nothing to hear:
 * this directory did not exist, and `state.soundOn` was a flag wired to
 * nothing. Phase 8 of the original plan was never built.
 *
 * Everything is SYNTHESIZED at runtime -- no audio files anywhere. That is
 * not an aesthetic choice, it is what keeps the three hard guarantees this
 * project has carried since day one: zero runtime dependencies, one
 * self-contained index.html, and it works opened from file://. A single
 * 200kB .wav would break all three.
 *
 * Two constraints are structural rather than stylistic:
 *
 *   1. NOTHING may touch AudioContext before a user gesture. Browsers
 *      autoplay-block a context created on load, and one created and left
 *      suspended is worse than none -- it looks wired up and is silent.
 *      `unlock()` is called from the JACK IN click and nowhere else.
 *   2. A mash spree must not spawn unbounded oscillators. Every voice is
 *      counted, capped, and self-releases in `onended`.
 */

type Ctor = typeof AudioContext

/** Modest on purpose. Nobody's first impression should be a jump scare. */
const DEFAULT_GAIN = 0.28

/**
 * Concurrent voices. A key click is ~40ms, so at 7 keys/sec a player holds
 * roughly one live voice; twelve leaves headroom for a klaxon over a
 * breakthrough over mashing without ever growing without bound.
 */
const MAX_VOICES = 12

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private live = 0
  private enabled = false
  private drone: HeatDrone | null = null

  /** True once a gesture has actually created the context. */
  get unlocked(): boolean {
    return this.ctx !== null
  }

  get on(): boolean {
    return this.enabled && this.ctx !== null
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0
  }

  /**
   * Called from a real user gesture (Dashboard.start -- JACK IN). Safe to
   * call repeatedly; the context is created once and kept for the page.
   */
  unlock(): void {
    if (!this.enabled || this.ctx) return
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) as Ctor | undefined
    if (!Ctor) return
    try {
      this.ctx = new Ctor()
    } catch {
      // No audio device, blocked by policy, or a headless runner. Silence
      // is an acceptable outcome; a thrown error during JACK IN is not.
      return
    }
    this.master = this.ctx.createGain()
    this.master.gain.value = DEFAULT_GAIN
    this.master.connect(this.ctx.destination)
    // Some browsers hand back a suspended context even from a gesture.
    void this.ctx.resume().catch(() => {})
  }

  /** The dashboard SOUND toggle. Takes effect immediately, in both directions. */
  setEnabled(on: boolean): void {
    this.enabled = on
    if (!this.ctx || !this.master) return
    this.master.gain.setTargetAtTime(on ? DEFAULT_GAIN : 0, this.ctx.currentTime, 0.02)
    if (!on) this.stopDrone()
  }

  /**
   * Claim a voice slot and the node to connect it to.
   *
   * Returns null when muted, locked, or at the cap -- callers treat that as
   * "don't play", never as an error. Callers MUST call `release()` when the
   * voice ends, which the helpers in sounds.ts do from `onended`.
   */
  acquire(): { ctx: AudioContext; dest: GainNode } | null {
    if (!this.enabled || !this.ctx || !this.master) return null
    if (this.live >= MAX_VOICES) return null
    this.live += 1
    return { ctx: this.ctx, dest: this.master }
  }

  release(): void {
    if (this.live > 0) this.live -= 1
  }

  /** Diagnostics for the voice-cap test. */
  get liveVoices(): number {
    return this.live
  }

  /**
   * A white-noise buffer, made once and shared by every noise voice.
   *
   * Generating a fresh second of noise per key click would allocate ~176kB
   * on every keystroke, which at mashing speed is the one thing in this
   * file that could actually cost frames.
   */
  noise(): AudioBuffer | null {
    if (!this.ctx) return null
    if (this.noiseBuf) return this.noiseBuf
    const len = Math.floor(this.ctx.sampleRate * 0.5)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    // Deliberately Math.random: this is a sample buffer, not a game draw.
    // Nothing about it is replayed, compared, or seeded -- the ?seed= rule
    // exists so a filmed take reproduces, and noise texture cannot differ
    // observably. Every gameplay draw still goes through core/rng.
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    return buf
  }

  // -- the drone ---------------------------------------------------------

  /**
   * A low bed whose weight tracks HEAT. This is the one continuous sound,
   * and it is what makes the room feel like it is closing in without a
   * single line of dialogue.
   */
  setHeat(heat: number): void {
    if (!this.enabled || !this.ctx || !this.master) return
    if (!this.drone) this.drone = new HeatDrone(this.ctx, this.master)
    this.drone.set(Math.max(0, Math.min(100, heat)))
  }

  stopDrone(): void {
    this.drone?.stop()
    this.drone = null
  }

  /** Between sessions. The context itself is kept -- one per page, forever. */
  reset(): void {
    this.stopDrone()
    this.live = 0
  }
}

class HeatDrone {
  private a: OscillatorNode
  private b: OscillatorNode
  private filter: BiquadFilterNode
  private gain: GainNode
  private stopped = false

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 90
    this.filter.Q.value = 3

    // Two detuned saws a hair apart -- the beating between them is what
    // makes it read as machinery rather than a test tone.
    this.a = ctx.createOscillator()
    this.a.type = 'sawtooth'
    this.a.frequency.value = 47
    this.b = ctx.createOscillator()
    this.b.type = 'sawtooth'
    this.b.frequency.value = 47.6

    this.a.connect(this.filter)
    this.b.connect(this.filter)
    this.filter.connect(this.gain)
    this.gain.connect(dest)
    this.a.start()
    this.b.start()
  }

  set(heat: number): void {
    if (this.stopped) return
    const t = this.ctx.currentTime
    const f = heat / 100
    // Silent at zero heat: a bed that never goes away stops meaning
    // anything. Ramped, never stepped -- a jump reads as a click.
    this.gain.gain.setTargetAtTime(f * f * 0.20, t, 0.6)
    this.filter.frequency.setTargetAtTime(80 + f * 260, t, 0.8)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const t = this.ctx.currentTime
    this.gain.gain.setTargetAtTime(0, t, 0.12)
    // Let the fade finish before tearing the graph down, or the stop is
    // itself an audible click.
    setTimeout(() => {
      try {
        this.a.stop()
        this.b.stop()
        this.a.disconnect()
        this.b.disconnect()
        this.filter.disconnect()
        this.gain.disconnect()
      } catch {
        /* already torn down */
      }
    }, 500)
  }
}

/** One bus for the page. Imported, never re-instantiated. */
export const audio = new AudioEngine()
