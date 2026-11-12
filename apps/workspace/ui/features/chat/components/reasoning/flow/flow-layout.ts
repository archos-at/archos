import { ColumnSlot } from './flow-node-data'

/**
 * Narrowest a source card may get before we stack instead of adding a column.
 *
 * 172: a hyphenated twelve-letter compound („Brandschutzkonzept“) keeps a
 * syllable of four on each line, where 146 cut it into three-letter shards.
 * Still three columns in the 680px chat column; two from 544px down, then one.
 */
const MIN_COL_W = 172

/** Widest a single column grows to, so 2 sources don't become two half-pages. */
const MAX_COL_W = 236

/**
 * At or below this content width the fan always collapses to ONE grouped
 * column. A phone would arithmetically fit two ~160px columns, but a source
 * card's name is a two-line clamp — side-by-side at that width it turns into
 * two columns of ellipses. This is a readability floor, not a fitting rule.
 */
export const GROUPED_MAX_W = 420

const COL_GAP = 14

/** Vertical gap between graph rows (framing / sources / assessment). */
export const ROW_GAP = 40

/**
 * Container bottom padding below the last row.
 *
 * Must clear what renders OUTSIDE a node's border box, because React Flow's
 * pane clips: `shadow-xs` bleeds a few px past the last row.
 */
export const PAD = 24

/** Floor for the content width, so a not-yet-measured container still builds. */
const MIN_CONTENT_W = 220

/**
 * Width assumed until the container has reported a real one — a typical
 * desktop chat column. `clientWidth` is 0 in jsdom and in any display:none
 * ancestor, and the graph must still render there; the first real measurement
 * replaces it (before paint, since it runs in a layout effect). Once measured,
 * a later 0 keeps the last real width ({@link measuredFanWidth}): falling back
 * here then is what drew a 680 px graph into a 648 px panel.
 */
export const FALLBACK_W = 680

/**
 * The width the fan is planned against after the container reports
 * `clientWidth`. A width of 0 is no measurement: the container is out of
 * layout for a moment (a `display:none` ancestor, a hidden tab, a full-page
 * capture that shrinks the viewport to 1×1 to read the page's size), so the
 * last real width stands. Planning against 0 fell through to
 * {@link FALLBACK_W}, 680 px, and for that moment every panel narrower than
 * 680 drew its framing, its sources and its Grundlagen past its right edge,
 * where the pane's `overflow-hidden` cut the words off.
 */
export function measuredFanWidth(previous: number, clientWidth: number): number {
  return clientWidth > 0 ? clientWidth : previous
}

/** How the sources are packed into columns for a given container width. */
export interface FanLayout {
  /** Card indices per column, left→right. Empty when the turn has no sources. */
  columns: number[][]
  colW: number
  gap: number
  /** x of the first column (the fan is centred in the content width). */
  fanX: number
  contentW: number
  /**
   * Narrow container → the single column wears the grouped "Quellen"
   * container. Note this is about the WIDTH, not the column count: one source
   * on a desktop is a single normal card, not a full-width box.
   */
  grouped: boolean
}

/**
 * Pack `cardCount` source cards into as many columns as `width` affords.
 *
 * Exported for tests: this is the whole responsive story, and the property that
 * matters is that the desktop chat column NEVER degrades to a single column
 * just because a turn touched a lot of documents — it packs wider instead.
 */
export function planFan(width: number, cardCount: number): FanLayout {
  const contentW = Math.max(MIN_CONTENT_W, Math.floor(width) || MIN_CONTENT_W)
  const grouped = contentW <= GROUPED_MAX_W
  if (cardCount <= 0) {
    return { columns: [], colW: contentW, gap: COL_GAP, fanX: 0, contentW, grouped: false }
  }
  const capacity = grouped
    ? 1
    : Math.max(1, Math.floor((contentW + COL_GAP) / (MIN_COL_W + COL_GAP)))
  const count = Math.min(cardCount, capacity)
  const colW = grouped
    ? contentW
    : Math.min(MAX_COL_W, Math.floor((contentW - (count - 1) * COL_GAP) / count))
  const fanW = count * colW + (count - 1) * COL_GAP
  const fanX = Math.max(0, Math.round((contentW - fanW) / 2))

  // Balanced, reading-order distribution: the remainder lands on the LEFT
  // columns so the row is never one lone tall column at the end.
  const base = Math.floor(cardCount / count)
  const remainder = cardCount % count
  const columns: number[][] = []
  let next = 0
  for (let c = 0; c < count; c++) {
    const size = base + (c < remainder ? 1 : 0)
    columns.push(Array.from({ length: size }, () => next++))
  }
  return { columns, colW, gap: COL_GAP, fanX, contentW, grouped }
}

/**
 * {@link planFan} over a fan's slots. An OPEN fold is no card: it is the way
 * back, a line under the last uncited card, so it takes no column of its own
 * and hangs under that card, which reading order puts in the last column.
 */
export function packSlots(width: number, slots: readonly ColumnSlot[]): FanLayout {
  const last = slots.at(-1)
  const openFold = last?.type === 'fold' && last.expanded
  if (!openFold) return planFan(width, slots.length)
  const packed = planFan(width, slots.length - 1)
  const columns = packed.columns.map((column, i, all) =>
    i === all.length - 1 ? [...column, slots.length - 1] : column
  )
  return { ...packed, columns }
}
