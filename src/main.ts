import { createInitialState } from '@/core/state'
import { initLayoutMode } from '@/core/device'
import { initTheme, restoreThemeIfSaved } from '@/themes/themes'
import { Shell } from '@/ui/shell'

import '@/styles/base.css'
import '@/styles/terminal.css'
import '@/styles/fx.css'
import '@/styles/shell.css'
import '@/styles/windows.css'
import '@/styles/hud.css'
import '@/styles/panels.css'
import '@/styles/target.css'
// Last, so its [data-layout='mobile'] rules win over the desktop defaults
// they override without needing !important on every declaration.
import '@/styles/mobile.css'

const root = document.getElementById('app')
if (!root) throw new Error('#app mount point missing from index.html')

const state = createInitialState()
restoreThemeIfSaved(state)
initTheme(state)
// Must run before the Shell mounts so the very first layout pass already
// has data-layout set -- otherwise the board flashes the desktop layout.
initLayoutMode()

new Shell(root, state)
