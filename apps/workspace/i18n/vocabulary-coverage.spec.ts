/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { en, de } from './dictionaries'
import { getByPath } from './translate'

const ONE_FACT_ONE_WORD: Record<string, string[]> = {
  'document: indexed and citable': [
    'files.uploads.row.ready',
    'files.status.ready',
    'files.filters.status.ready',
  ],

  'document: still being processed': [
    'files.uploads.row.processing',
    'files.status.processing',
    'files.filters.status.processing',
    'research.fileSourceCard.statusIngesting',
  ],

  'upload: identical file, not sent again': [
    'files.folderUpload.action.unchanged',
    'uploadBatches.summary.counts.unchanged',
  ],

  'document: held back by the content check': [
    'files.status.quarantined',
    'files.uploads.row.held',
    'files.brief.slice.held',
    'research.fileSourceCard.statusHeld',
  ],

  'document: stored, not read': [
    'files.status.stored',
    'files.uploads.row.stored',
    'research.fileSourceCard.statusStored',
  ],

  'document: processing failed': [
    'files.uploads.row.failed',
    'files.status.failed',
    'files.filters.status.failed',
  ],

  'document: reading failed, said on a peek': ['files.preview.peekFailedHint', 'chat.fileReference.failed'],

  'document: read it again': [
    'files.actions.reingest',
    'files.preview.retryIngestion',
    'officeShelf.actions.reingest',
    'officeShelf.actions.reingestConfirmAction',
  ],

  'fassung status: draft': ['files.lifecycle.states.draft', 'chat.cards.documentDraft.draftState'],
  'fassung status: in review': ['files.lifecycle.states.inReview', 'chat.cards.documentDraft.inReview'],
  'fassung status: changes requested': [
    'files.lifecycle.states.changesRequested',
    'files.lifecycle.versions.changesRequested',
    'chat.cards.documentDraft.changesRequested',
  ],
  'fassung status: approved': [
    'files.lifecycle.states.approved',
    'files.lifecycle.versions.approved',
    'chat.cards.documentDraft.approved',
  ],
  'fassung status: published': [
    'files.lifecycle.states.published',
    'files.lifecycle.versions.published',
    'chat.cards.documentDraft.published',
  ],
  'fassung status: replaced': ['files.lifecycle.states.superseded', 'chat.cards.documentDraft.ersetzt'],

  'fassung approval: the signature': [
    'files.lifecycle.approveConfirm.checkbox',
    'collaboration.inbox.review.approveConfirm',
  ],

  'fassung approval: submit': ['files.lifecycle.actions.submit', 'chat.cards.documentDraft.submit'],
}

const LOCALES = { en, de } as const

describe('one fact, one word', () => {
  for (const [fact, keys] of Object.entries(ONE_FACT_ONE_WORD)) {
    for (const [locale, dictionary] of Object.entries(LOCALES)) {
      it(`${locale} — ${fact}`, () => {
        const words = keys.map((key) => ({
          key,
          word: getByPath(dictionary as unknown as Record<string, unknown>, key),
        }))

        const missing = words.filter((entry) => typeof entry.word !== 'string' || entry.word === '')
        expect(missing.map((entry) => entry.key)).toEqual([])

        const distinct = [...new Set(words.map((entry) => entry.word as string))]
        expect(
          distinct,
          `These keys state one fact and must carry one word:\n${words
            .map((entry) => `  ${entry.key} → ${JSON.stringify(entry.word)}`)
            .join('\n')}`,
        ).toHaveLength(1)
      })
    }
  }
})
