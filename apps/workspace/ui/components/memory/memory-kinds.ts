'use client'

import { useMemo } from 'react'
import { useTranslations } from '@/i18n'
import { memoryNotesCopy } from '@/i18n/namespaces/memory-notes'

const KNOWN_KINDS = new Set(Object.keys(memoryNotesCopy.messages.en.kinds))

export interface MemoryKindLabels {
  kind: (kind: string) => string
  group: (kind: string) => string
}

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
