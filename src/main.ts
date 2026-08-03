import { createInitialState } from '@/core/state'
import { initTheme, restoreThemeIfSaved } from '@/themes/themes'
import { Shell } from '@/ui/shell'

import '@/styles/base.css'
import '@/styles/terminal.css'
import '@/styles/fx.css'
import '@/styles/shell.css'
import '@/styles/windows.css'
import '@/styles/hud.css'

const root = document.getElementById('app')
if (!root) throw new Error('#app mount point missing from index.html')

const state = createInitialState()
restoreThemeIfSaved(state)
initTheme(state)

new Shell(root, state)
