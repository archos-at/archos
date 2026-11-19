'use client'

import { useCallback } from 'react'
import { useTranslations } from '@/i18n'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import type { InboundMailPartView } from '@/lib/inbound-mail/inbound-mail-wire'
import { CLAUSE_JOIN } from '@/lib/format'
import type { OpenReason, PlanLine } from '../lib/filing-plan'
import { indexChange } from '../lib/plan-index'
import { filesCopy } from '@/i18n/namespaces/files'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

type Kept = Exclude<PlanLine, { kind: 'left' | 'text_left' }>
type Left = Extract<PlanLine, { kind: 'left' | 'text_left' }>

export interface PlanWords {
  subject: (line: PlanLine) => string
  /** Where „Übersicht“ says a filed part goes, the place first: „Tragwerk · Index D ersetzt Index C (C bleibt erhalten)“. */
  destination: (line: Kept) => string
  outcome: (line: Left) => string
  phrase: (line: PlanLine, open: OpenReason | null, part: InboundMailPartView) => string | null
}

/** One vocabulary for what filing does with a part, so the pane and „Übersicht“ never say it two ways. */
export function usePlanWords(): PlanWords {
  const t = useTranslations(inboundMailCopy)
  const tFiles = useTranslations(filesCopy)

  const folder = useCallback((path: string): string => (path === '' ? t('suggestion.root') : path), [t])
  const place = useCallback(
    (line: Extract<PlanLine, { kind: 'file' }>): string =>
      [
        ...(line.besides ? [t('filing.pane.besides', { of: line.besides })] : []),
        line.newFolder ? t('filing.overview.newFolderNamed', { folder: folder(line.folder) }) : t('filing.overview.folder', { folder: folder(line.folder) }),
        ...(line.documentType ? [t('filing.overview.documentType', { type: tagLabel(line.documentType, tFiles) })] : []),
        ...(line.rename ? [t('filing.overview.renamed', { name: line.rename })] : []),
      ].join(CLAUSE_JOIN),
    [folder, t, tFiles]
  )

  const revisionPhrase = useCallback(
    (line: Extract<PlanLine, { kind: 'revision' }>): string =>
      line.index
        ? t('filing.overview.revisionIndex', { ...line.index })
        : t('filing.overview.revision', { version: line.version, of: line.of, previous: line.version - 1 }),
    [t]
  )

  const leftWords = useCallback(
    (line: Extract<PlanLine, { kind: 'left' }>): string =>
      line.why === 'risk' && line.risk
        ? t(`filing.overview.left.${line.risk}`)
        : t(`filing.overview.left.${line.why}`, { terms: line.terms.join('“, „') }),
    [t]
  )

  const subject = useCallback(
    (line: PlanLine): string => (line.kind === 'text_append' || line.kind === 'text_create' || line.kind === 'text_left' ? t('filing.overview.text') : line.name),
    [t]
  )

  const destination = useCallback(
    (line: Kept): string => {
      const masked = (on: boolean): string => (on ? ` ${t('filing.overview.masked')}` : '')
      switch (line.kind) {
        case 'text_append':
          return t('filing.overview.toThread', { name: line.thread }) + masked(line.masked)
        case 'text_create':
          return t('filing.overview.toNewThread', { name: line.thread, folder: folder(line.folder) }) + masked(line.masked)
        case 'file':
          return [
            line.newFolder ? t('filing.overview.newFolderNamed', { folder: folder(line.folder) }) : folder(line.folder),
            ...(line.documentType ? [tagLabel(line.documentType, tFiles)] : []),
            ...(line.besides ? [t('filing.overview.besides', { of: line.besides })] : []),
            ...(line.rename ? [t('filing.overview.renamed', { name: line.rename })] : []),
          ].join(CLAUSE_JOIN)
        case 'revision':
          return [...(line.folder !== null ? [folder(line.folder)] : []), revisionPhrase(line)].join(CLAUSE_JOIN)
        case 'no_folder':
          return t('filing.overview.noFolder')
      }
    },
    [folder, revisionPhrase, t, tFiles]
  )

  const outcome = useCallback(
    (line: Left): string => (line.kind === 'text_left' ? t('filing.overview.textLeft') : leftWords(line)),
    [leftWords, t]
  )

  const phrase = useCallback(
    (line: PlanLine, open: OpenReason | null, part: InboundMailPartView): string | null => {
      if (open) {
        const revision = part.revisionCandidate
        const index = revision ? indexChange(part.filename, revision.name) : null
        if (open === 'revision_unsure' && revision && index) return t('filing.pane.open.revision_unsure_index', { ...index, of: revision.name })
        return t(`filing.pane.open.${open}`, revision ? { version: revision.nextVersion, of: revision.name } : {})
      }
      switch (line.kind) {
        case 'file':
          return place(line)
        case 'revision': {
          const words = [revisionPhrase(line), ...(line.folder !== null ? [t('filing.overview.folder', { folder: folder(line.folder) })] : [])].join(CLAUSE_JOIN)
          return words.charAt(0).toLocaleUpperCase() + words.slice(1)
        }
        case 'no_folder':
          return t('filing.pane.noFolder')
        case 'left':
          return leftWords(line)
        default:
          return null
      }
    },
    [folder, leftWords, place, revisionPhrase, t]
  )

  return { subject, destination, outcome, phrase }
}
