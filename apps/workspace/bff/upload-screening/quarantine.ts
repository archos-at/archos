import { z } from 'zod'
import type { Translator } from '@/i18n/translate'
import type { NameMatch } from './name-screen'

const QUARANTINED_PREFIX = 'quarantined:'

export const QUARANTINED_REPLACE_REASON = 'quarantined'

export function isQuarantinedReplaceBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const details = (body as { details?: unknown }).details
  return !!details && typeof details === 'object' && (details as { reason?: unknown }).reason === QUARANTINED_REPLACE_REASON
}

const reasonSchema = z.object({
  kind: z.enum(['term', 'iban', 'at_svnr', 'credit_card', 'de_svnr', 'de_tax_id']).or(z.string().transform((): 'other' => 'other')),
  term: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
  pages: z.array(z.number().int()).optional(),
  pages_truncated: z.boolean().optional(),
  sample: z.string().optional(),
})

export const verdictSchema = z.object({
  reasons: z.array(reasonSchema),
  checked: z.enum(['full', 'partial']).optional(),
  omitted: z.number().int().positive().optional(),
  after_transcription: z.boolean().optional(),
})

const storedVerdictSchema = verdictSchema.extend({
  reasons: z.array(reasonSchema.extend({ kind: z.string().min(1) })),
})

export type QuarantineReason = z.infer<typeof reasonSchema>
export type QuarantineVerdict = z.infer<typeof verdictSchema>
export type StoredQuarantineVerdict = z.infer<typeof storedVerdictSchema>

export interface QuarantineSource {
  quarantine?: unknown
  errorMessage?: string | null
  error_message?: string | null
}

function legacyVerdictJson(errorMessage: string | null | undefined): unknown {
  if (!errorMessage?.startsWith(QUARANTINED_PREFIX)) return undefined
  try {
    return JSON.parse(errorMessage.slice(QUARANTINED_PREFIX.length))
  } catch {
    return undefined
  }
}

function rawVerdictOf(source: QuarantineSource): unknown {
  if (source.quarantine !== undefined && source.quarantine !== null) return source.quarantine
  return legacyVerdictJson(source.errorMessage ?? source.error_message)
}

export function reportsQuarantine(source: QuarantineSource): boolean {
  if (source.quarantine !== undefined && source.quarantine !== null) return true
  return (source.errorMessage ?? source.error_message)?.startsWith(QUARANTINED_PREFIX) ?? false
}

export function readQuarantineVerdict(value: unknown): QuarantineVerdict | null {
  if (value === undefined || value === null) return null
  const parsed = verdictSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function quarantineVerdictOf(source: QuarantineSource): QuarantineVerdict | null {
  return readQuarantineVerdict(rawVerdictOf(source))
}

export function heldSentenceKey(
  verdict: QuarantineVerdict | null | undefined
): 'ingestFailure.quarantined' | 'ingestFailure.quarantinedAfterTranscription' | 'ingestFailure.quarantinedUnreadable' {
  if (!verdict || (verdict.reasons.length === 0 && !verdict.omitted)) return 'ingestFailure.quarantinedUnreadable'
  return verdict.after_transcription ? 'ingestFailure.quarantinedAfterTranscription' : 'ingestFailure.quarantined'
}

export type QuarantineNoticeVariant = 'term' | 'iban' | 'at_svnr' | 'credit_card' | 'de_svnr' | 'de_tax_id' | 'transcript'

export function quarantineNoticeVariant(verdict: QuarantineVerdict | null): QuarantineNoticeVariant | null {
  if (!verdict) return null
  if (verdict.after_transcription) return 'transcript'
  const kind = verdict.reasons[0]?.kind
  return kind === undefined || kind === 'other' ? null : kind
}

export function quarantineNoticePayload(
  doc: QuarantineSource & { filename: string }
): { subject: string; variant: QuarantineNoticeVariant | null } {
  return { subject: doc.filename, variant: quarantineNoticeVariant(quarantineVerdictOf(doc)) }
}

export function storedQuarantineVerdictOf(source: QuarantineSource): StoredQuarantineVerdict | null {
  const raw = rawVerdictOf(source)
  if (raw === undefined || raw === null) return null
  const parsed = storedVerdictSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export const AUDITED_REASONS_MAX_CHARS = 200
export const AUDITED_REASONS_CUT_MARK = ',…'

export function auditedQuarantineReasons(
  verdict: { reasons: ReadonlyArray<{ kind: string; term?: string }> } | null
): string {
  const listed = (verdict?.reasons ?? [])
    .map((reason) => (reason.kind === 'term' ? `term:${reason.term ?? ''}` : reason.kind))
    .join(',')
  if (listed.length <= AUDITED_REASONS_MAX_CHARS) return listed
  return listed.slice(0, AUDITED_REASONS_MAX_CHARS - AUDITED_REASONS_CUT_MARK.length) + AUDITED_REASONS_CUT_MARK
}

export function quarantineReasonHead(reason: QuarantineReason, t: Translator): string {
  const head =
    reason.kind === 'term'
      ? t('screening.reasonTerm', { term: reason.term ?? '' })
      : reason.kind === 'iban'
        ? t('screening.reasonIban', { sample: reason.sample ?? '' })
        : reason.kind === 'at_svnr' || reason.kind === 'de_svnr'
          ? t('screening.reasonSvnr', { sample: reason.sample ?? '' })
          : reason.kind === 'de_tax_id'
            ? t('screening.reasonTaxId', { sample: reason.sample ?? '' })
          : reason.kind === 'credit_card'
            ? t('screening.reasonCard', { sample: reason.sample ?? '' })
            : t('screening.reasonOther')
  return head.trim()
}

export function explainQuarantineReason(reason: QuarantineReason, t: Translator): string {
  switch (reason.kind) {
    case 'term':
      return t('screening.basisTerm')
    case 'iban':
      return t('screening.basisIban')
    case 'at_svnr':
      return t('screening.basisSvnr')
    case 'credit_card':
      return t('screening.basisCard')
    case 'de_svnr':
      return t('screening.basisDeSvnr')
    case 'de_tax_id':
      return t('screening.basisTaxId')
    default:
      return t('screening.basisOther')
  }
}

export const MORE_PAGES_MARK = '…'

export function describeQuarantineReason(reason: QuarantineReason, t: Translator): string {
  const head = quarantineReasonHead(reason, t)
  const pages = reason.pages ?? []
  if (pages.length === 0) return `${head} · ${t('screening.reasonNoPages')}`
  const listed = reason.pages_truncated ? [...pages, MORE_PAGES_MARK] : pages
  return `${head} · ${t('screening.reasonPages', { count: pages.length, pages: listed.join(', ') })}`
}

export interface QuarantineFinding {
  page: number
  highlight: string | null
}

export function findingsOf(reason: QuarantineReason): QuarantineFinding[] {
  const highlight = reason.kind === 'term' && reason.term ? reason.term : null
  return (reason.pages ?? []).filter((page) => page >= 1).map((page) => ({ page, highlight }))
}

export function firstFinding(verdict: QuarantineVerdict | null): QuarantineFinding | null {
  for (const reason of verdict?.reasons ?? []) {
    const [first] = findingsOf(reason)
    if (first) return first
  }
  return null
}

export function describeNameMatch(match: NameMatch, t: Translator): string {
  return match.kind === 'file'
    ? t('screening.nameInFile', { term: match.term })
    : t('screening.nameInFolder', { term: match.term, segment: match.segment })
}

export function describeScreenedOut(
  screenedOut: ReadonlyArray<{ file: { name: string }; matches: readonly NameMatch[] }>,
  t: Translator
): string | null {
  if (screenedOut.length === 0) return null
  return t('errors.screenedOut', {
    count: screenedOut.length,
    files: screenedOut
      .slice(0, 3)
      .map(({ file, matches }) =>
        t('errors.screenedOutFile', {
          name: file.name,
          reason: matches.map((match) => describeNameMatch(match, t)).join(', '),
        })
      )
      .join(', '),
  })
}
