import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import type { DocumentStatus } from './document-status'

export type DocumentReadingEvent =
  | 'dispatch'
  | 'process'
  | 'complete'
  | 'fail'
  | 'quarantine'
  | 'cancel'
  | 'resume'
  | 'unindex'
  | 'replace'
  | 'release'
  | 'rescreen'

export const DOCUMENT_READING_LIFECYCLE = defineLifecycle<DocumentStatus, DocumentReadingEvent>({
  id: 'document-reading',
  initial: 'uploaded',
  bornAs: ['stored'],
  states: {
    uploaded: { on: { dispatch: 'pending', process: 'processing', fail: 'failed', unindex: 'stored' } },
    pending: {
      on: {
        complete: 'completed',
        fail: 'failed',
        quarantine: 'quarantined',
        cancel: 'cancelled',
        process: 'processing',
        unindex: 'stored',
        replace: 'uploaded',
      },
    },
    processing: {
      on: {
        dispatch: 'pending',
        complete: 'completed',
        fail: 'failed',
        quarantine: 'quarantined',
        unindex: 'stored',
        replace: 'uploaded',
      },
    },
    completed: {
      on: {
        dispatch: 'pending',
        process: 'processing',
        fail: 'failed',
        unindex: 'stored',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
    failed: {
      on: {
        dispatch: 'pending',
        resume: 'pending',
        process: 'processing',
        complete: 'completed',
        unindex: 'stored',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
    quarantined: { on: { release: 'uploaded', rescreen: 'uploaded' } },
    stored: {
      on: {
        dispatch: 'pending',
        process: 'processing',
        fail: 'failed',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
    cancelled: {
      on: {
        dispatch: 'pending',
        process: 'processing',
        complete: 'completed',
        fail: 'failed',
        unindex: 'stored',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
  },
})

export function statusesAccepting(event: DocumentReadingEvent): DocumentStatus[] {
  const moves = DOCUMENT_READING_LIFECYCLE.moves.filter((move) => move.event === event)
  return DOCUMENT_READING_LIFECYCLE.states.filter((state) =>
    moves.some((move) => move.from === state || move.to === state),
  )
}
