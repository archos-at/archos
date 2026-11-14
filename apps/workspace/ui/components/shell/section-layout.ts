/**
 * The widths a section's page shares with its header, so title and content stand on one left edge. A leaf module:
 * the pages that only need a class do not pull the frame (and a spec that mocks the frame keeps these).
 */

/**
 * A reading column of a section's page (a task list, a form): the content container with the header's margins, so it
 * starts on the title's left edge, and its children end at the reading measure (48rem). The Automatisierung's lists
 * were centred at 768px under a header that started at the screen's edge (review of 2026-11-11).
 */
export const SECTION_READING_COLUMN = 'listing-container px-4 md:px-8 [&>*]:max-w-3xl'

/** A header's children at the content container's width (`listing-container` less its 32px margins), centred with it. */
export const SECTION_CONTENT_WIDTH = '[&>*]:max-w-[1216px] @min-[90rem]/section:[&>*]:mx-auto'
