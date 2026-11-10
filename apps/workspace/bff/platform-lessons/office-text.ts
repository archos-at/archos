import { sql } from 'drizzle-orm'

/**
 * The voted answer drew on no office text (design E44): its stored sources (the citations and
 * the Herleitung's lanes, both in `messages.metadata`) name no hit from the office shelf and
 * no lane of the `office` kind. An office document, or the office's licensed copy of a norm
 * (ADR-0159), is that office's, and a lesson distilled from it would carry it into every
 * other office's turns. Read from the jsonb the turn wrote, at any depth, so a new place a
 * source is stored is covered too. Expects the voted answer aliased `m` (`VOTED_TURN_JOINS`).
 */
export const OUTSIDE_OFFICE_TEXT = sql`not jsonb_path_exists(coalesce(m.metadata, '{}'::jsonb), '$.** ? (@ == "office_shelf" || @ == "office")')`
