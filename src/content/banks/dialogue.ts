import type { Bank } from '../grammar'

/** Handler/operator asides, taunts, and mission-framing dialogue. */
export const dialogue: Bank = {
  handlerIdle: [
    { t: '[HANDLER] {org} rotates their logs every {int:5-30} minutes. Move.', w: 2 },
    { t: '[HANDLER] Anyone watching {host} tonight?', w: 1 },
    { t: "[HANDLER] Don't linger on {host}.", w: 1 },
    { t: '[HANDLER] Nice. Keep that pace.', w: 1 },
    { t: '[HANDLER] {int:1-9} minutes before the shift change on {host}.', w: 1 },
    { t: '[HANDLER] Traffic on {cidr} looks normal. For now.', w: 1 },
    { t: '[HANDLER] {org} security desk just rotated -- window is open.', w: 1 },
  ],
  handlerBrief: [
    { t: '[HANDLER] Target: {org}. Confirm perimeter before anything else.', w: 2 },
    { t: '[HANDLER] We need eyes past the gateway before the window closes.', w: 1 },
  ],
  taunt: [
    'a system message flickers: "IS THAT ALL?"',
    'the terminal briefly displays a smiling ASCII face, then clears',
    'a countdown appears for {int:3-9} seconds, then vanishes',
  ],
}
