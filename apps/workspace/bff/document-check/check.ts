import { v5 as uuidv5 } from 'uuid'
import type { AnnotationRecord } from '@/lib/annotations/repository'

export const MAX_FINDINGS = 4
export const POLL_SECONDS = 30
export const MAX_WAITS = 60

export const DEFAULT_DAILY_LIMIT = 25
export const DEFAULT_MAX_BATCH = 10

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export const documentCheckDailyLimit = (env: Record<string, string | undefined> = process.env): number =>
  nonNegativeInt(env.DOCUMENT_CHECK_DAILY_LIMIT, DEFAULT_DAILY_LIMIT)

export const documentCheckMaxBatch = (env: Record<string, string | undefined> = process.env): number =>
  nonNegativeInt(env.DOCUMENT_CHECK_MAX_BATCH, DEFAULT_MAX_BATCH)

const hex = (value: string) => value.replace(/-/g, '_')

export function documentCheckId(documentId: string, versionKey: string): string {
  return uuidv5(`grid:document-check:${documentId}:${versionKey}`, uuidv5.URL)
}

export const documentCheckConversationId = (checkId: string): string => `s_${hex(checkId)}`

export function documentCheckMessageId(checkId: string): string {
  return uuidv5(`grid:document-check-message:${checkId}`, uuidv5.URL)
}

export function checkInstruction(document: { id: string; name: string }): string {
  return [
    `A new document was just uploaded to this project and indexed: "${document.name}" (document id ${document.id}).`,
    "Check it against the project's other documents, as a careful colleague would.",
    '1. Read the new document and find the 2 to 4 load-bearing facts it states: counts, areas, heights, classes, dates, named standards or approvals, anything other documents also depend on.',
    "2. Check each fact against the project's other documents: where else the fact is stated, and the passage itself. Compare with the newest Fassung of each document.",
    `3. Only where a fact contradicts another document, propose a mark on the new document with canvas__mark (kind hint, on the place that states the fact, at most ${MAX_FINDINGS} marks). The body names both values; the basis cites both sources by file name and page. Never open a mark and never say a deviation is allowed or forbidden.`,
    '4. Where everything agrees, or nothing comparable exists, propose nothing and answer with the single word "Agrees".',
    'Nobody watches this turn and nobody answers questions: do not ask anything, and do not change anything except by proposing marks.',
  ].join('\n')
}

const clip = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`
}

export function checkMessage(input: {
  documentName: string
  marks: ReadonlyArray<Pick<AnnotationRecord, 'page' | 'body'>>
}): string {
  const { marks } = input
  const count = marks.length === 1 ? 'Eine Stelle ist' : `${marks.length} Stellen sind`
  return [
    `Ich habe das neue Dokument „${input.documentName}“ mit den übrigen Unterlagen des Projekts abgeglichen. ${count} am Dokument als Vorschlag markiert, noch nicht übernommen:`,
    '',
    ...marks.map((mark, index) => `${index + 1}. S. ${mark.page}: ${clip(mark.body, 400)}`),
    '',
    'Das ist ein Abgleich von Angaben zwischen Dokumenten, keine Prüfung gegen Vorschriften. Übernehmen oder verwerfen Sie die Vorschläge in der Prüfansicht.',
  ].join('\n')
}

export function checkExcerpt(marks: ReadonlyArray<Pick<AnnotationRecord, 'page' | 'body'>>): string | null {
  const first = marks[0]
  return first ? clip(`S. ${first.page}: ${first.body}`, 200) : null
}
