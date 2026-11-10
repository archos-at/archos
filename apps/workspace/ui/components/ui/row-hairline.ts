/**
 * The hairline between list rows (paper on a desk, principle 5: lines for
 * lists, space for sections). It sits on the row's bottom edge, inset to the
 * text edge by `inset` (a Tailwind `left-*` step), and the last row has none.
 * The line is the `hairline` token (ink at 8%), so it composites on paper, on
 * the desk and on a white sheet alike.
 */
export const ROW_HAIRLINE =
  'relative after:pointer-events-none after:absolute after:bottom-0 after:left-11 after:right-3 after:h-px after:bg-hairline last:after:hidden'

/**
 * A row's secondary actions: hidden on a fine pointer until the row is
 * hovered, focused or selected, always shown on a coarse one (principle 6).
 * Put it on the ⋯ trigger; the row carries `group/row`.
 */
export const ROW_REVEAL =
  'pointer-coarse:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-aria-selected/row:opacity-100 group-data-[state=selected]/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity duration-quick ease-out motion-reduce:transition-none'
