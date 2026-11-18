import { z } from 'zod'

export const SCREENING_DETECTORS = ['iban', 'at_svnr', 'credit_card', 'de_svnr', 'de_tax_id'] as const
export type ScreeningDetector = (typeof SCREENING_DETECTORS)[number]

export interface UploadScreeningPolicy {
  enabled: boolean
  nameTerms: string[]
  nameExceptions: string[]
  contentTerms: string[]
  detectors: ScreeningDetector[]
}

export const SUGGESTED_SCREENING_POLICY: UploadScreeningPolicy = {
  enabled: true,
  nameTerms: [
    'Rechnung',
    'Honorar',
    'Lohn',
    'Gehalt',
    'Personal',
    'Vertrag',
    'Bewerbung',
    'Krankenstand',
    'Kontoauszug',
    'Buchhaltung',
    'Steuer',
  ],
  nameExceptions: [
    'Berechnung',
    'Bauvertrag',
    'Steuerung',
    'Steuerleitung',
    'Steuerventil',
    'Personalraum',
    'Personalräume',
    'Personalaufzug',
    'Personaleingang',
    'Feuchtegehalt',
    'Feuchtigkeitsgehalt',
    'Wassergehalt',
    'Salzgehalt',
    'Chloridgehalt',
    'Luftgehalt',
    'Vertragsplan',
    'Rechnungsprüfung',
    'Abrechnung',
  ],
  contentTerms: [
    'Gehaltsabrechnung',
    'Lohnzettel',
    'Lohnabrechnung',
    'Honorarvereinbarung',
    'Honorarnote',
    'Dienstvertrag',
    'Arbeitsvertrag',
    'Sozialversicherungsnummer',
    'Krankenstandsbestätigung',
    'Kontoauszug',
  ],
  detectors: ['iban', 'at_svnr', 'credit_card', 'de_svnr', 'de_tax_id'],
}

const MAX_TERMS = 200
const MAX_TERM_LENGTH = 80

const termList = z
  .array(z.string())
  .max(MAX_TERMS)
  .transform((terms) => normalizeTermList(terms))
  .refine((terms) => terms.every((term) => term.length <= MAX_TERM_LENGTH), {
    message: `A term is at most ${MAX_TERM_LENGTH} characters`,
  })

export const uploadScreeningPolicySchema = z
  .object({
    enabled: z.boolean(),
    nameTerms: termList,
    nameExceptions: termList,
    contentTerms: termList,
    detectors: z.array(z.enum(SCREENING_DETECTORS)).max(SCREENING_DETECTORS.length),
  })
  .strict()

export function normalizeTermList(terms: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms) {
    const term = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
    if (term.length < 2) continue
    const key = term.toLocaleLowerCase('de')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

export function resolveUploadScreeningPolicy(stored: unknown): UploadScreeningPolicy {
  if (stored === undefined || stored === null) return SUGGESTED_SCREENING_POLICY
  const parsed = uploadScreeningPolicySchema.safeParse(stored)
  return parsed.success ? parsed.data : SUGGESTED_SCREENING_POLICY
}

export interface IngestScreening {
  content_terms: string[]
  detectors: ScreeningDetector[]
}

export function toIngestScreening(
  policy: UploadScreeningPolicy,
  options: { released: boolean }
): IngestScreening | null {
  if (!policy.enabled || options.released) return null
  if (policy.contentTerms.length === 0 && policy.detectors.length === 0) return null
  return { content_terms: [...policy.contentTerms], detectors: [...policy.detectors] }
}

export interface ChatScreening {
  enabled: boolean
  content_terms: string[]
  detectors: ScreeningDetector[]
}

export function toChatScreening(policy: UploadScreeningPolicy): ChatScreening {
  return { enabled: policy.enabled, content_terms: [...policy.contentTerms], detectors: [...policy.detectors] }
}
