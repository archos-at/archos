import { BadRequestError } from '@/lib/api/errors'
import { buildContentRules, findSpans, type ContentScreenRules } from '@/lib/upload-screening/content-screen'
import { SCREENING_DETECTORS } from '@/lib/upload-screening/policy'
import {
  NOTE_REFUSED_REASON,
  SECRET_KINDS,
  type ContactKind,
  type NoteRefusalKind,
  type SecretKind,
} from './note-refusal'

export { CONTACT_KINDS, NOTE_REFUSED_REASON, SECRET_KINDS } from './note-refusal'
export type { ContactKind, NoteRefusalKind, SecretKind } from './note-refusal'

const KIND_NAMES: Record<NoteRefusalKind, string> = {
  iban: 'a bank account number (IBAN)',
  at_svnr: 'a social-insurance number',
  credit_card: 'a payment card number',
  de_svnr: 'a German pension-insurance number',
  de_tax_id: 'a German tax identification number',
  private_key: 'a private key',
  api_key: 'an API key or access token',
  credential: 'a password or access code',
  identity_number: 'an identity or tax number',
  email: 'an e-mail address',
  phone: 'a phone number',
}

const DETECTORS_ONLY = buildContentRules([], SCREENING_DETECTORS) as ContentScreenRules

const WORD = 'A-Za-z0-9ÄÖÜäöüß'
const LETTER = 'A-Za-zÄÖÜäöüß'
const SP = '[ \\t\\u00a0]'
const TOKEN = '[^ \\t\\r\\n\\u00a0]+'

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

const API_KEY = new RegExp(
  '(?<![A-Za-z0-9])(?:' +
    'sk[-_](?:live|test|proj|ant|or)[-_][A-Za-z0-9_-]{3,}' +
    '|(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}' +
    '|gh[pousr]_[A-Za-z0-9]{20,}' +
    '|github_pat_[A-Za-z0-9_]{20,}' +
    '|glpat-[A-Za-z0-9_-]{20,}' +
    '|(?:AKIA|ASIA)[0-9A-Z]{16}' +
    '|xox[abprs]-[A-Za-z0-9-]{10,}' +
    '|AIza[0-9A-Za-z_-]{35}' +
    '|hf_[A-Za-z0-9]{30,}' +
    '|npm_[A-Za-z0-9]{36}' +
    '|eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}' +
    ')'
)
const LONG_TOKEN = /(?<![A-Za-z0-9+=_-])[A-Za-z0-9+=_-]{24,}(?![A-Za-z0-9+=_-])/g
const RANDOM_MIN_CHARS = 24
const RANDOM_MIN_EACH = 6

const STRONG_LABEL =
  '(?:(?:passwor[dt]|passwd|kennwort|passphrase|losungswort|api[ _-]?key|api[ _-]?schl(?:ü|ue)ssel' +
  `|client[ _-]?secret)|(?<![${WORD}])(?:pw|pwd|secret|token))(?![${WORD}])`
const LABELLED_VALUE = new RegExp(
  `${STRONG_LABEL}(?:${SP}*([:=])${SP}*|${SP}+(?:(?:ist|lautet|is)${SP}+)?)(${TOKEN})`,
  'gi'
)
const WEAK_LABEL = new RegExp(
  '(?:zugang(?:sdaten)?|log-?in|anmeld(?:ung|edaten)|account)[^:=\\r\\n]{0,30}[:=]([^\\r\\n]{0,80})',
  'gi'
)
const ACCESS_CODE = new RegExp(
  `(?:(?<![${WORD}])pin(?:-?code)?` +
    `|(?<![${LETTER}])(?:haust(?:ü|ue)r|t(?:ü|ue)r|tor|garagen|tresor|alarm|zugangs|safe|schl(?:ü|ue)sselbox)-?code)` +
    `${SP}*[:=]?${SP}*[0-9]{4,8}(?![0-9])`,
  'i'
)
const BEARER = new RegExp(`(?<![${WORD}])bearer${SP}+[A-Za-z0-9._~+/=-]{16,}`, 'i')
const SPLIT_SPACE = /[ \t ]+/
const LEADING_QUOTES = /^["'`„“”‚‘’«»(]+/
const TRAILING_MARKS = /["'`“”‘’«»).,;:]+$/
const STRONG_SIGNS = /[!#$%&*+?@^~<>|\\]/
const URL_START = /^(?:https?:\/\/|www\.)/i
const EMAIL_TOKEN = /^[^@]+@[^@]+\.[A-Za-z]{2,}$/
const LOWER = /[a-zäöüß]/g
const UPPER = /[A-ZÄÖÜ]/g
const DIGIT = /[0-9]/g
const ALL_DIGITS = /^[0-9]+$/

const IDENTITY_LABEL = new RegExp(
  `(?:steuernummer|steuer-?nr|(?<![${WORD}])st\\.?-?nr|personalausweis|reisepass|ausweisn(?:ummer|r)` +
    '|passn(?:ummer|r)|f(?:ü|ue)hrerschein|sozialversicherungsn(?:ummer|r)' +
    `|(?<![${WORD}])sv-?n(?:ummer|r))([^\\r\\n]{0,40})`,
  'gi'
)
const IDENTITY_MIN_DIGITS = 6
const US_SSN = /(?<![0-9-])[0-9]{3}-[0-9]{2}-[0-9]{4}(?![0-9-])/

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/
const DATE_SHAPE = /(?<![0-9])(?:[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/g
const PHONE_INTERNATIONAL = /(?<![A-Za-z0-9])(?:\+|00)[1-9][0-9 ()/-]{5,}[0-9]/g
const PHONE_NATIONAL =
  /(?<![A-Za-z0-9.,/-])0[1-9](?:[0-9]{7,12}|[0-9]{0,4}[ /-]{1,3}\(?[0-9][0-9 ()/-]{3,}[0-9])(?![0-9])/g
const PHONE_LABELLED = new RegExp(
  `(?<![${LETTER}])(?:tel(?:efon)?|mobil(?:tel(?:efon)?)?|handy|fax|phone|mobile)\\.?(?:nr\\.?|nummer)?` +
    `${SP}*:?${SP}*\\+?[0-9][0-9 ()/-]{4,}[0-9]`,
  'gi'
)
const PHONE_MIN_DIGITS = 8
const PHONE_MAX_DIGITS = 17
const LABELLED_PHONE_MIN_DIGITS = 6

const count = (pattern: RegExp, text: string): number => text.match(pattern)?.length ?? 0

const valueOf = (token: string): string => token.replace(LEADING_QUOTES, '').replace(TRAILING_MARKS, '')

function characterClasses(value: string): [boolean, boolean, boolean, boolean] {
  return [count(LOWER, value) > 0, count(UPPER, value) > 0, count(DIGIT, value) > 0, STRONG_SIGNS.test(value)]
}

function isLabelledPassword(token: string, explicit: boolean): boolean {
  const value = valueOf(token)
  if (value.length < 4 || URL_START.test(value)) return false
  if (explicit && ALL_DIGITS.test(value)) return true
  const classes = characterClasses(value)
  return (classes[2] || classes[3]) && classes.filter(Boolean).length >= 2
}

function isUnlabelledPassword(token: string): boolean {
  const value = valueOf(token)
  if (value.length < 6 || URL_START.test(value) || EMAIL_TOKEN.test(value)) return false
  const [lower, upper, digit, sign] = characterClasses(value)
  return (lower || upper) && digit && sign
}

function isRandomToken(run: string): boolean {
  return run.split(/[-_]/).some(
    (part) =>
      part.length >= RANDOM_MIN_CHARS &&
      count(DIGIT, part) >= RANDOM_MIN_EACH &&
      count(LOWER, part) + count(UPPER, part) >= RANDOM_MIN_EACH
  )
}

function hasCredential(text: string): boolean {
  if (ACCESS_CODE.test(text) || BEARER.test(text)) return true
  for (const match of text.matchAll(LABELLED_VALUE)) {
    if (isLabelledPassword(match[2], match[1] !== undefined)) return true
  }
  for (const match of text.matchAll(WEAK_LABEL)) {
    if (match[1].split(SPLIT_SPACE).some(isUnlabelledPassword)) return true
  }
  return false
}

export function secretKind(content: string): SecretKind | null {
  const [span] = findSpans(content, DETECTORS_ONLY)
  if (span) return span.kind as SecretKind
  if (PRIVATE_KEY.test(content)) return 'private_key'
  if (API_KEY.test(content) || (content.match(LONG_TOKEN) ?? []).some(isRandomToken)) return 'api_key'
  if (hasCredential(content)) return 'credential'
  for (const match of content.matchAll(IDENTITY_LABEL)) {
    if (count(DIGIT, match[1]) >= IDENTITY_MIN_DIGITS) return 'identity_number'
  }
  return US_SSN.test(content) ? 'identity_number' : null
}

const digitsBetween = (text: string, low: number, high: number): boolean => {
  const digits = count(DIGIT, text)
  return low <= digits && digits <= high
}

export function contactKind(content: string): ContactKind | null {
  if (EMAIL.test(content)) return 'email'
  const scrubbed = content.replace(DATE_SHAPE, ' ')
  const unlabelled = [...(scrubbed.match(PHONE_INTERNATIONAL) ?? []), ...(scrubbed.match(PHONE_NATIONAL) ?? [])]
  if (unlabelled.some((found) => digitsBetween(found, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS))) return 'phone'
  const labelled = scrubbed.match(PHONE_LABELLED) ?? []
  if (labelled.some((found) => digitsBetween(found, LABELLED_PHONE_MIN_DIGITS, PHONE_MAX_DIGITS))) return 'phone'
  return null
}

export function noteRefusal(content: string, shared: boolean): NoteRefusalKind | null {
  return secretKind(content) ?? (shared ? contactKind(content) : null)
}

export function assertStorableNote(content: string, options: { refuseContact: boolean }): void {
  const kind = noteRefusal(content, options.refuseContact)
  if (!kind) return
  const where = SECRET_KINDS.includes(kind as SecretKind) ? 'A memory note' : 'A note in shared memory'
  throw new BadRequestError(
    `${where} cannot hold ${KIND_NAMES[kind]}. Nothing was saved: leave it out and save the note again.`,
    { reason: NOTE_REFUSED_REASON, kind }
  )
}
