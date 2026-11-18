import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { DOCUMENT_TYPE_TAGS, type DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import { folderPathKey } from '@/lib/projects/folders'
import {
  filingFitResponseSchema,
  type FilingConventionInput,
  type FilingFolderInput,
  type FilingJudgement,
  type FilingJudgementInput,
  type FilingMove,
  type MailFilingInput,
  type MailFilingJudgement,
  type MailPlacement,
} from './types'

const TIMEOUT_MS = { name: 30_000, content: 60_000, mail: 60_000 } as const
const SORT_TIMEOUT_MS = 90_000

type RawMove = {
  id: string
  folder: string
  reason: string
  new?: boolean
  description?: string | null
  confidence?: number | null
  type?: string | null
}

const MAX_REASON = 300

const cleanReason = (reason: string): string => reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON)

export function keepKnownMoves(moves: readonly RawMove[], input: FilingJudgementInput): FilingMove[] {
  const documents = new Map(input.documents.map((document) => [document.id, document]))
  const existing = new Map(input.folders.map((folder) => [folderPathKey(folder.path), folder]))
  const conventions = new Map(input.conventions.map((convention) => [folderPathKey(convention.path), convention]))
  const kept: FilingMove[] = []
  const seen = new Set<string>()
  for (const move of moves) {
    const document = documents.get(move.id)
    const key = folderPathKey(move.folder)
    const reason = cleanReason(move.reason)
    if (!document || seen.has(document.id) || !key || !reason) continue
    if (key === folderPathKey(document.folder)) continue
    const folder = existing.get(key)
    const convention = folder ? undefined : conventions.get(key)
    if (!folder && !convention) continue
    seen.add(document.id)
    kept.push({
      documentId: document.id,
      folder: folder?.path ?? convention?.path ?? move.folder,
      reason,
      newFolder: convention ? { description: convention.description } : null,
      confidence: move.confidence ?? null,
    })
  }
  return kept
}

const folderBody = (folder: FilingFolderInput) => ({
  path: folder.path,
  description: folder.description,
  doc_types: folder.docTypes,
})

const conventionBody = (convention: FilingConventionInput) => ({
  path: convention.path,
  description: convention.description,
  projects: convention.projects,
  doc_types: convention.docTypes,
})

export function filingFitBody(input: FilingJudgementInput): object {
  return {
    basis: input.basis,
    purpose: input.purpose ?? 'upload',
    locale: input.locale,
    folders: input.folders.map(folderBody),
    conventions: input.conventions.map(conventionBody),
    documents: input.documents.map((document) => ({
      id: document.id,
      file: document.file,
      folder: document.folder,
      type: document.type,
      tags: document.tags,
      summary: document.summary,
    })),
    trace: { batch_id: input.trace.batchId, project_id: input.trace.projectId, shelf: input.trace.shelf },
  }
}

interface Answered {
  moves: RawMove[]
  traceId: string | null
  error: string | null
}

async function askFilingFit(organizationId: string, body: object, timeoutMs: number): Promise<Answered> {
  try {
    const response = await fetch(`${getBackendUrl()}/v1/filing-fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-organization-id': organizationId },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { moves: [], traceId: null, error: `backend_${response.status}` }
    const parsed = filingFitResponseSchema.safeParse(await response.json())
    if (!parsed.success) return { moves: [], traceId: null, error: 'response_malformed' }
    const { moves, error, trace_id: traceId } = parsed.data
    if (error) return { moves: [], traceId: traceId ?? null, error }
    return { moves, traceId: traceId ?? null, error: null }
  } catch {
    return { moves: [], traceId: null, error: 'backend_unreachable' }
  }
}

export async function judgeFiling(organizationId: string, input: FilingJudgementInput): Promise<FilingJudgement> {
  if (input.documents.length === 0 || (input.folders.length === 0 && input.conventions.length === 0)) {
    return { moves: [], traceId: null, error: null }
  }
  const timeoutMs = input.purpose === 'sort' ? SORT_TIMEOUT_MS : TIMEOUT_MS[input.basis]
  const answered = await askFilingFit(organizationId, filingFitBody(input), timeoutMs)
  if (answered.error) return { moves: [], traceId: answered.traceId, error: answered.error }
  return { moves: keepKnownMoves(answered.moves, input), traceId: answered.traceId, error: null }
}

export function mailFilingBody(input: MailFilingInput): object {
  return {
    basis: 'mail',
    purpose: 'upload',
    locale: input.locale,
    folders: input.folders.map(folderBody),
    conventions: input.conventions.map(conventionBody),
    documents: input.attachments.map((attachment) => ({ id: attachment.id, file: attachment.file })),
    mail: { subject: input.mail.subject, sender_domain: input.mail.senderDomain, text_id: input.mail.textId },
    trace: { batch_id: input.trace.mailId, project_id: input.trace.projectId, shelf: 'project', sender_class: input.trace.senderClass },
  }
}

const isDocumentType = (value: unknown): value is DocumentTypeTag =>
  typeof value === 'string' && (DOCUMENT_TYPE_TAGS as readonly string[]).includes(value)

export function keepMailPlacements(moves: readonly RawMove[], input: MailFilingInput): MailPlacement[] {
  const parts = new Set(input.attachments.map((attachment) => attachment.id))
  if (input.mail.textId) parts.add(input.mail.textId)
  const existing = new Map(input.folders.map((folder) => [folderPathKey(folder.path), folder]))
  const conventions = new Map(input.conventions.map((convention) => [folderPathKey(convention.path), convention]))
  const kept: MailPlacement[] = []
  const seen = new Set<string>()
  for (const move of moves) {
    const key = folderPathKey(move.folder)
    const reason = cleanReason(move.reason)
    if (!parts.has(move.id) || seen.has(move.id) || !key || !reason) continue
    const folder = existing.get(key)
    const convention = folder ? undefined : conventions.get(key)
    if (!folder && !convention) continue
    seen.add(move.id)
    kept.push({
      partId: move.id,
      folder: folder?.path ?? convention?.path ?? move.folder,
      newFolder: convention ? { description: convention.description } : null,
      documentType: move.id !== input.mail.textId && isDocumentType(move.type) ? move.type : null,
      reason,
    })
  }
  return kept
}

export async function judgeMailFiling(organizationId: string, input: MailFilingInput): Promise<MailFilingJudgement> {
  const nothingToPlace = input.attachments.length === 0 && !input.mail.textId
  if (nothingToPlace || (input.folders.length === 0 && input.conventions.length === 0)) {
    return { placements: [], traceId: null, error: null }
  }
  const answered = await askFilingFit(organizationId, mailFilingBody(input), TIMEOUT_MS.mail)
  if (answered.error) return { placements: [], traceId: answered.traceId, error: answered.error }
  return { placements: keepMailPlacements(answered.moves, input), traceId: answered.traceId, error: null }
}
