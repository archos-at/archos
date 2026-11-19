'use client'

import { useCallback } from 'react'
import { useTranslations } from '@/i18n'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import type { InboundMailPartView } from '@/lib/inbound-mail/inbound-mail-wire'
import { CLAUSE_JOIN } from '@/lib/format'
import type { OpenReason, PlanLine } from '../lib/filing-plan'
import { filesCopy } from '@/i18n/namespaces/files'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface PlanWords {
  subject: (line: PlanLine) => string
  outcome: (line: PlanLine) => string
  phrase: (line: PlanLine, open: OpenReason | null, part: InboundMailPartView) => string | null
}

const ARROW = '→ '

/** One vocabulary for what filing does with a part, so the pane and „Übersicht“ never say it two ways. */
export function usePlanWords(): PlanWords {
  const t = useTranslations(inboundMailCopy)
  const tFiles = useTranslations(filesCopy)

  const folder = useCallback((path: string): string => (path === '' ? t('suggestion.root') : path), [t])
  const place = useCallback(
    (line: Extract<PlanLine, { kind: 'file' }>): string =>
      [
        folder(line.folder) + (line.newFolder ? ` ${t('filing.overview.newFolder')}` : ''),
        ...(line.documentType ? [tagLabel(line.documentType, tFiles)] : []),
        ...(line.rename ? [t('filing.overview.renamed', { name: line.rename })] : []),
      ].join(CLAUSE_JOIN),
    [folder, t, tFiles]
  )

  const subject = useCallback(
    (line: PlanLine): string => (line.kind === 'text_append' || line.kind === 'text_create' || line.kind === 'text_left' ? t('filing.overview.text') : line.name),
    [t]
  )

  const outcome = useCallback(
    (line: PlanLine): string => {
      const masked = (on: boolean): string => (on ? ` ${t('filing.overview.masked')}` : '')
      switch (line.kind) {
        case 'text_append':
          return ARROW + t('filing.overview.textAppend', { name: line.thread }) + masked(line.masked)
        case 'text_create':
          return ARROW + t('filing.overview.textCreate', { name: line.thread, folder: folder(line.folder) }) + masked(line.masked)
        case 'text_left':
          return t('filing.overview.textLeft')
        case 'file':
          return ARROW + place(line)
        case 'revision':
          return ARROW + t('filing.overview.revision', { version: line.version, of: line.of })
        case 'no_folder':
          return ARROW + t('filing.overview.noFolder')
        case 'left':
          return t(`filing.overview.left.${line.why}`)
      }
    },
    [folder, place, t]
  )

  const phrase = useCallback(
    (line: PlanLine, open: OpenReason | null, part: InboundMailPartView): string | null => {
      if (open) {
        const revision = part.revisionCandidate
        return t(`filing.pane.open.${open}`, revision ? { version: revision.nextVersion, of: revision.name } : {})
      }
      switch (line.kind) {
        case 'file':
          return t('filing.pane.to', { folder: place(line) })
        case 'revision':
          return t('filing.pane.revision', { version: line.version, of: line.of })
        case 'no_folder':
          return t('filing.pane.noFolder')
        case 'left':
          return t(`filing.overview.left.${line.why}`)
        default:
          return null
      }
    },
    [place, t]
  )

  return { subject, outcome, phrase }
}
