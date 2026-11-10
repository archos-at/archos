/**
 * The hairline between list rows (paper on a desk, principle 5: lines for
 * lists, space for sections). ONE INSET RULE for every list: the line runs
 * from the row's first text to the row's text end, so a leading column (a
 * checkbox, an avatar, a format, a glyph, a marker) hangs left of it. The list
 * says where that is with two custom properties on the row or any ancestor:
 * `--row-text` (from the row's left edge to its first text) and `--row-end`
 * (the row's right padding). The last row has none, and neither has a row with
 * a fill of its own (the open row's sheet, a picked or selected row: it says
 * so with `data-filled`) nor the row above it: a line against a fill is a
 * second edge. The line is the
 * `hairline` token (ink at 8%), so it composites on paper, on the desk and on a
 * white sheet alike.
 */
export const ROW_HAIRLINE_LINE =
  'relative after:pointer-events-none after:absolute after:bottom-0 after:left-[var(--row-text,0px)] after:right-[var(--row-end,0px)] after:h-px after:bg-hairline data-filled:after:hidden [&:has(+[data-filled])]:after:hidden'
export const ROW_HAIRLINE = `${ROW_HAIRLINE_LINE} last:after:hidden`

/**
 * A row's secondary actions: hidden on a fine pointer until the row is
 * hovered, focused or selected, always shown on a coarse one (principle 6).
 * Put it on the ⋯ trigger; the row carries `group/row`.
 */
export const ROW_REVEAL =
  'pointer-coarse:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-aria-selected/row:opacity-100 group-data-[state=selected]/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity duration-quick ease-out motion-reduce:transition-none'

/**
 * The same rule for a table row (`<tr>`), which cannot carry the pseudo-element:
 * an absolutely placed `::after` on a row became an anonymous cell in Chrome and
 * squeezed every column into the table's left half. The line is drawn as a 1px
 * background on each cell instead; the cell marked `data-row-text` starts it
 * `--row-lead` in (its leading column: a format, a glyph), the last cell stops
 * it `--row-end` short, and a cell marked `data-row-skip` (a checkbox column)
 * draws none.
 */
export const TABLE_ROW_HAIRLINE =
  '[&>td]:bg-[image:linear-gradient(var(--hairline),var(--hairline))] [&>td]:bg-no-repeat [&>td]:bg-bottom [&>td]:bg-[length:100%_1px] [&>td[data-row-text]]:bg-right-bottom [&>td[data-row-text]]:bg-[length:calc(100%-var(--row-lead,0px))_1px] [&>td:last-child]:bg-left-bottom [&>td:last-child]:bg-[length:calc(100%-var(--row-end,0px))_1px] [&>td[data-row-skip]]:bg-none last:[&>td]:bg-none data-filled:[&>td]:bg-none [&:has(+[data-filled])>td]:bg-none'
