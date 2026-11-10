import { sql } from 'drizzle-orm'

/**
 * The voted answer read no licensed text (design E44, ADR-0164). The server marks the ANSWER row of a turn that
 * read an office's licensed copy with `licensedText: true` (`chat_socket.persist_turn_result` →
 * `agent-answer-metadata.ts`; merged into a row the browser stored first, `persistInternalConversationMessages`).
 * The browser never writes it, so a closed tab or a stopped turn keeps it. The office's licensed text is that
 * office's, and a lesson distilled from it would carry it into every other office's turns. The mark is written
 * only where licensed text was read, so an office without the `licensed-seam` flag sees no change.
 * Expects the voted answer aliased `m` (`VOTED_TURN_JOINS`).
 */
export const OUTSIDE_LICENSED_TEXT = sql`coalesce(m.metadata->>'licensedText', '') <> 'true'`
