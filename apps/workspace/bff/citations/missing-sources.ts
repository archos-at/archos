import 'server-only'
import type { FailedTargetRow } from './repository'

export type MissingSourceKind = 'document' | 'ris' | 'web'

export type MissingSourceAction =
  | 'add_to_norm_catalog'
  | 'upload_to_base_knowledge'
  | 'investigate_retrieval'
  | 'none'
  | 'inventory_unknown'

export interface MissingSourceCandidate {
  target: string
  kind: MissingSourceKind
  reason: string
  turns: number
  organizations: number
  lastSeenAt: string
  present: boolean | null
  action: MissingSourceAction
  fileName: string | null
  documentNumber: string | null
}

const RIS_HOST_RE = /^https?:\/\/(?:[\w-]+\.)*ris\.bka\.gv\.at\b/i
const URL_RE = /^https?:\/\//i
const FILE_KEY_RE = /^(.+?\.[A-Za-z0-9]{2,5})(?:\s*,\s*(?:p\.?|page|S\.)\s*\d+)?$/i
const RIS_DOCUMENT_NUMBER_RE = /(?:Dokumentnummer=|\/)(N[A-Z]{2}\d{6,}|[A-Z]{2,}_\d{8}_[\w]+)/i

export function classifyTarget(target: string): MissingSourceKind {
  if (RIS_HOST_RE.test(target)) return 'ris'
  if (URL_RE.test(target)) return 'web'
  return FILE_KEY_RE.test(target) ? 'document' : 'web'
}

export function fileNameFromTarget(target: string): string | null {
  const match = FILE_KEY_RE.exec(target.trim())
  if (!match) return null
  return match[1].trim().replace(/^.*[/\\]/, '')
}

export function risDocumentNumber(target: string): string | null {
  return RIS_DOCUMENT_NUMBER_RE.exec(target)?.[1] ?? null
}

const normalizeFileName = (name: string): string => name.trim().toLowerCase()

export interface PlatformInventory {
  corpusFileNames: string[] | null
  catalogedDocumentNumbers: string[] | null
}

export function buildMissingSourceCandidates(
  rows: FailedTargetRow[],
  inventory: PlatformInventory
): MissingSourceCandidate[] {
  const corpus = inventory.corpusFileNames
    ? new Set(inventory.corpusFileNames.map(normalizeFileName))
    : null
  const cataloged = inventory.catalogedDocumentNumbers
    ? new Set(inventory.catalogedDocumentNumbers.map((value) => value.trim().toLowerCase()))
    : null

  return rows.map((row) => {
    const kind = classifyTarget(row.target)
    const fileName = kind === 'document' ? fileNameFromTarget(row.target) : null
    const documentNumber = kind === 'ris' ? risDocumentNumber(row.target) : null
    const { present, action } = decide(kind, fileName, documentNumber, corpus, cataloged)

    return {
      target: row.target,
      kind,
      reason: row.reason,
      turns: row.turns,
      organizations: row.organizations,
      lastSeenAt: row.lastSeenAt.toISOString(),
      present,
      action,
      fileName,
      documentNumber,
    }
  })
}

function decide(
  kind: MissingSourceKind,
  fileName: string | null,
  documentNumber: string | null,
  corpus: Set<string> | null,
  cataloged: Set<string> | null
): { present: boolean | null; action: MissingSourceAction } {
  if (kind === 'ris' && documentNumber) {
    if (!cataloged) return { present: null, action: 'inventory_unknown' }
    return cataloged.has(documentNumber.toLowerCase())
      ? { present: true, action: 'investigate_retrieval' }
      : { present: false, action: 'add_to_norm_catalog' }
  }
  if (kind === 'document' && fileName) {
    if (!corpus) return { present: null, action: 'inventory_unknown' }
    return corpus.has(normalizeFileName(fileName))
      ? { present: true, action: 'investigate_retrieval' }
      : { present: false, action: 'upload_to_base_knowledge' }
  }
  return { present: false, action: 'none' }
}
