/**
 * What the composer is asked to hold before a send: the subject of an ask and
 * a queued prefill. Moved out of `types.ts`, which re-exports both.
 */

import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { DraftMention } from '@/lib/mentions/mention-text'

/** What this ask is about (a file the turn started from): the same composer, not a second chat. */
export interface ComposerSubject {
  resourceType: 'document'
  resourceId: string
  title?: string | null
  /** Stored file name — retrieval identity, not the label. */
  filename?: string | null
  /**
   * Which knowledge shelf the file sits on. Sent as ``focus_shelf``; the
   * agent maps it to the shelves it may keep. "Summarize this upload"
   * does not walk the Archiv (#429); a project file does not mix in
   * Büro hits (#436).
   */
  shelf?: 'project' | 'office_shelf' | 'session'
  /**
   * The subject's OPEN version — the one still being worked on — when it has
   * one, so the turn can read a document retrieval cannot see.
   *
   * Only a published version reaches the retrieval index (ADR-0054), so a
   * draft, an in-review or a changes-requested document has no chunks and the
   * focus filter falls open to the whole corpus. These two fields travel to the
   * agent as ``focus_version_id`` / ``focus_version_state``; it reads the
   * version's bytes into the conversation's working directory instead.
   *
   * Absent means "the live bytes are the published ones" and nothing changes.
   */
  versionId?: string | null
  versionState?: DocumentVersionState | null
}

/** A queued composer prefill: the text plus any structured mentions it renders. */
export interface ComposerPrefill {
  text: string
  mentions?: DraftMention[]
  /**
   * Optional subject of this ask (a project file). IFC walls, applicable
   * standards and Files all land here — one pipe.
   */
  subject?: ComposerSubject
}
