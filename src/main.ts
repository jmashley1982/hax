import { createInitialState } from '@/core/state'
import { initLayoutMode } from '@/core/device'
import { initTheme, restoreThemeIfSaved, applyLayerSkin } from '@/themes/themes'
import { App } from '@/app'

import '@/styles/base.css'
import '@/styles/terminal.css'
import '@/styles/fx.css'
import '@/styles/shell.css'
import '@/styles/windows.css'
import '@/styles/hud.css'
import '@/styles/panels.css'
import '@/styles/target.css'
import '@/styles/layers.css'
import '@/styles/dashboard.css'
import '@/styles/boot.css'
import '@/styles/reverse.css'
import '@/styles/chain.css'
import '@/styles/messenger.css'
import '@/styles/desktop.css'
import '@/styles/lockout.css'
// Last, so its [data-layout='mobile'] rules win over the desktop defaults
// they override without needing !important on every declaration.
import '@/styles/mobile.css'

const root = document.getElementById('app')
if (!root) throw new Error('#app mount point missing from index.html')

// ?seed=<label> locks the run's entire random stream. Everything derives
// from this one value (plan §11's "seed lock" for reshoot determinism), so
// the same seed replays the same targets, panels, waves and lockouts --
// which is what makes a filmed take repeatable, and what makes the random
// events testable without waiting for luck.
const seedParam = new URLSearchParams(location.search).get('seed')
const state = createInitialState(seedParam ?? undefined)
restoreThemeIfSaved(state)
initTheme(state)
// Must run before the Shell mounts so the very first layout pass already
// has data-layout set -- otherwise the board flashes the desktop layout.
initLayoutMode()
// Depth skin for the starting layer -- without this the board renders with
// no data-layer until the first breakthrough, so SURFACE would be the one
// layer with no visual identity of its own.
applyLayerSkin(state.layer)

new App(root, state)
