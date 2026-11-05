/**
 * The heights a control row is built from, one per `size`, for every control
 * that sits in a row with a button: the button itself, and a field beside it.
 *
 * A field drew its own `h-9` while the buttons beside it were `sm` (`h-8`), so
 * in the Dateien header the search stood 4px taller than the Filter and
 * Hochladen around it. Both now read the height from here, so a retune moves
 * the row together. Under a finger every size is 44px (WCAG 2.2 Target Size).
 */
export const CONTROL_HEIGHT = {
  default: 'h-9 pointer-coarse:h-11',
  sm: 'h-8 pointer-coarse:h-11',
} as const

export type ControlSize = keyof typeof CONTROL_HEIGHT
