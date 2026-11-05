/**
 * The chat's one column: the transcript (question, Herleitung, answer), the
 * composer under it, the banners above the composer, the status dock and the
 * thread header's pills all stand in it, so their edges line up.
 *
 * Two constants rather than one class list per surface, because the widths had
 * drifted: the transcript was `max-w-5xl` and the composer `max-w-4xl`, so the
 * answer card stood 64px wider than the input on each side (ticket #38, topic 8).
 * A surface that takes its width from here cannot drift again;
 * `thread-column.spec.ts` fails one that spells its own.
 *
 * `THREAD_COLUMN` is the box, `THREAD_GUTTER` the inset its contents keep from
 * the column's edge (and from a landscape phone's notch). Both whole strings,
 * because Tailwind reads source text.
 */

/** The column's box: centred, full width up to the reading measure. */
export const THREAD_COLUMN = 'mx-auto w-full max-w-5xl'

/**
 * The column's contents, for a surface whose full-width outer box already
 * carries `THREAD_GUTTER` (the thread header, whose outer box must span the
 * whole plane for its opaque surface): the column's 64rem less the 1.5rem gutter
 * on each side, so its pills stand on the answer's edges. Below `sm` the
 * viewport is narrower than this, so the smaller gutter never meets it.
 */
export const THREAD_COLUMN_INNER = 'mx-auto w-full max-w-[61rem]'

/** The column's side inset: 1rem on a phone, 1.5rem from `sm`, never inside a notch. */
export const THREAD_GUTTER =
  'pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))]'
