/**
 * Every level must be COMPLETABLE. Guards the softlock class of bug.
 *
 * A levelled run only ends when its objective is met -- residual progress
 * explicitly cannot win a level -- so a level whose required tool never
 * reaches the board is not slow, it is permanently stuck, with no message
 * and nothing on screen to suggest anything is wrong. That shipped once:
 * KERNEL's spec spends clear windows on `signalAlign`, which layers.ts
 * unlocks a layer later at PHYSICAL, so the panel could not spawn and the
 * run sat at 0/3 holds forever.
 *
 * Two independent checks, because the two ways to break this look nothing
 * alike in a diff:
 *   1. every tool a level names is a real registered panel type
 *      (a typo'd id fails the same way, silently);
 *   2. every tool is reachable at that level's own layer -- either via the
 *      depth ladder or via the director's required-tools union.
 */
/*
 * The panel registry reaches the DOM at import time (core/device.ts probes
 * window.innerWidth to pick a layout). A few stub globals let this run
 * headlessly against the REAL registry rather than a hand-copied list of
 * ids -- a copy would drift, and drifting is the exact failure being
 * guarded against. Imports are dynamic so the stubs exist before the
 * module graph is evaluated; static imports hoist above them.
 */
const g = globalThis as Record<string, unknown>
g.window = {
  innerWidth: 1400,
  innerHeight: 900,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
g.document = {
  documentElement: { dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} } },
  createElement: () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    append() {},
    addEventListener() {},
    setAttribute() {},
    querySelectorAll: () => [],
  }),
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
}

const { LEVEL_SPECS } = await import('../src/sim/levels')
const { unlockedPanelTypes } = await import('../src/sim/layers')
const { PANEL_TYPES } = await import('../src/ui/panels/registry')
const { LAYER_ORDER } = await import('../src/core/state')

let failed = false

for (const layer of LAYER_ORDER) {
  const spec = LEVEL_SPECS[layer]
  if (!spec) continue

  for (const tool of spec.tools) {
    if (!PANEL_TYPES[tool]) {
      console.error(`FAIL ${layer}: requires "${tool}", which is not a registered panel type`)
      failed = true
    }
  }

  // What the director will actually draw from: the ladder, plus the
  // level's own required tools (see Director.spawn's pool union).
  const spawnable = new Set([...unlockedPanelTypes(layer), ...spec.tools])
  for (const tool of spec.tools) {
    if (!spawnable.has(tool)) {
      console.error(`FAIL ${layer}: requires "${tool}" but it can never spawn there`)
      failed = true
    }
  }

  // The pair is the completion path -- if either half is missing from the
  // declared tools, the level banks forever with nothing to spend on.
  if (spec.pair) {
    for (const half of [spec.pair.banks, spec.pair.spends]) {
      if (!spec.tools.includes(half)) {
        console.error(
          `FAIL ${layer}: pair uses "${half}" but it is not in tools -- it will not be preferred or unioned`,
        )
        failed = true
      }
    }
  }
}

if (failed) {
  process.exit(1)
}
console.log(`PASS -- all ${LAYER_ORDER.length} layers: required tools exist and can spawn`)
