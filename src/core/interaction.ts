/**
 * "The player is in the middle of something."
 *
 * Ambient spawning (background process windows, camera popups) is on a
 * timer and knows nothing about what the player is doing, so it would
 * happily open a window on top of a drag already in progress -- reported
 * as "you can't drag and drop because windows pop up over it as you're
 * using it".
 *
 * Anything that owns the pointer for more than an instant raises this for
 * its duration, and every ambient spawner checks it. A counter rather than
 * a boolean so overlapping interactions can't clear it early.
 */
let depth = 0

export function beginInteraction(): void {
  depth += 1
}

export function endInteraction(): void {
  depth = Math.max(0, depth - 1)
}

export function isInteracting(): boolean {
  return depth > 0
}

/** Safety valve: a lost pointer must never leave ambient spawning wedged off forever. */
export function resetInteraction(): void {
  depth = 0
}
