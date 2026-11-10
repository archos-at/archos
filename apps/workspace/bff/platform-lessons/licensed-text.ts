import { sql } from 'drizzle-orm'

/**
 * The voted answer read no licensed text (design E44, ADR-0159). The licensed seam marks a turn that read an
 * office's licensed copy with a technical step of slot `licensed-text`, which rests in the answer's
 * `messages.metadata` with the rest of its Herleitung (`licensed_text._mark_turn`). The office's licensed text
 * is that office's, and a lesson distilled from it would carry it into every other office's turns. The mark
 * is written only where licensed text was read, so an office without the `licensed-seam` flag sees no change.
 * Expects the voted answer aliased `m` (`VOTED_TURN_JOINS`).
 */
export const OUTSIDE_LICENSED_TEXT = sql`not jsonb_path_exists(coalesce(m.metadata, '{}'::jsonb), '$.** ? (@.slot == "licensed-text")')`
