'use client'

/**
 * The one name of each kind of memory note (ADR-0180). The chip under an
 * answer, the proposal card and its receipt, a project's memory page and a
 * person's own read the label here, from the `memoryNotes` namespace, so a
 * kind cannot be called „Präferenz" in one place and „Arbeitsweise" in another.
 */

import { useMemo } from 'react'
import { useTranslations } from '@/i18n'
import { memoryNotesCopy } from '@/i18n/namespaces/memory-notes'

const KNOWN_KINDS = new Set(Object.keys(memoryNotesCopy.messages.en.kinds))

export interface MemoryKindLabels {
  /** One note of the kind: a row's meta line, a form's choice, a card's badge. */
  kind: (kind: string) => string
  /** The heading over the notes of one kind on a memory page. */
  group: (kind: string) => string
}

/** The labels in the reader's language; a kind this release does not know is shown as stored. */
export function useMemoryKindLabels(): MemoryKindLabels {
  const t = useTranslations(memoryNotesCopy)
  return useMemo(
    () => ({
      kind: (kind) => (KNOWN_KINDS.has(kind) ? t(`kinds.${kind}`) : kind),
      group: (kind) => (KNOWN_KINDS.has(kind) ? t(`kindGroups.${kind}`) : kind),
    }),
    [t],
  )
}
