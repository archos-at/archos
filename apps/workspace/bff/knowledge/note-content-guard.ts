/**
 * What a memory note may not hold: a secret anywhere, a way to reach a person
 * on a shared shelf. The ONE refusal, made at the single writer of each store
 * (`createProjectMemoryItem` / `updateProjectMemoryItem`, and the personal
 * service's create and edit), so a note typed in a memory panel, accepted on a
 * card, sent by an outside agent through the MCP door or written by the agent all
 * meet it. The office's screening mask (ADR-0086) runs first; this refuses
 * what the mask left.
 *
 * The twin of `agent.knowledge.memory_content_guard`, which gives the agent
 * the same refusal before its round trip. Both are held to one table,
 * `tests/fixtures/memory_note_guard_cases.json`, and every rule is written so
 * that the two regular-expression engines read it alike: ASCII classes spelt
 * out, no `\b` (the engines disagree on an umlaut), the same order of checks.
 *
 * Account and identity numbers are the content screen's detectors
 * (`upload-screening/content-screen.ts`), which count a number only when its
 * checksum holds (IBAN mod 97, the insurance numbers' check digits, Luhn in a
 * card network's range): a plot number, a drawing number or a date is not one.
 * Credentials are the rules here, since nothing in the repo detected them
 * (`text/redact-pii.ts` redacts a line after a keyword, which is right for a
 * scrub and far too broad for a refusal). The Python docstring says what the
 * rules deliberately miss.
 *
 * Pure: no database, no session.
 */

import { BadRequestError } from '@/lib/api/errors'
import { buildContentRules, findSpans, type ContentScreenRules } from '@/lib/upload-screening/content-screen'
import { SCREENING_DETECTORS } from '@/lib/upload-screening/policy'

/** The kinds a refusal names, in the order they are looked for. The first five are the content screen's detectors. */
export const SECRET_KINDS = [
  'iban',
  'at_svnr',
  'credit_card',
  'de_svnr',
  'de_tax_id',
  'private_key',
  'api_key',
  'credential',
  'identity_number',
] as const
export const CONTACT_KINDS = ['email', 'phone'] as const
export type SecretKind = (typeof SECRET_KINDS)[number]
export type ContactKind = (typeof CONTACT_KINDS)[number]
export type NoteRefusalKind = SecretKind | ContactKind

/** What a refusal calls each kind. English: an agent reads it too. Never the value found. */
const KIND_NAMES: Record<NoteRefusalKind, string> = {
  iban: 'a bank account number (IBAN)',
  at_svnr: 'an Austrian social-insurance number',
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

/** Every detector, no terms: independent of what the office's own policy switched on. */
const DETECTORS_ONLY = buildContentRules([], SCREENING_DETECTORS) as ContentScreenRules

const WORD = 'A-Za-z0-9ÄÖÜäöüß'
const LETTER = 'A-Za-zÄÖÜäöüß'
const SP = '[ \\t\\u00a0]'
const TOKEN = '[^ \\t\\r\\n\\u00a0]+'

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

/** Tokens that say what they are by their prefix: the shapes the providers document and gitleaks' default rules key on. */
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
/** A long unbroken run with no prefix to name it: judged by `isRandomToken`. */
const LONG_TOKEN = /(?<![A-Za-z0-9+=_-])[A-Za-z0-9+=_-]{24,}(?![A-Za-z0-9+=_-])/g
const RANDOM_MIN_CHARS = 24
const RANDOM_MIN_EACH = 6

/**
 * A word that says the next token is a credential. A long one may end a
 * compound („WLAN-Passwort", „Serverkennwort"); a short one stands alone.
 */
const STRONG_LABEL =
  '(?:(?:passwor[dt]|passwd|kennwort|passphrase|losungswort|api[ _-]?key|api[ _-]?schl(?:ü|ue)ssel' +
  `|client[ _-]?secret)|(?<![${WORD}])(?:pw|pwd|secret|token))(?![${WORD}])`
/** Group 1: an explicit `:` or `=`. Group 2: the value. */
const LABELLED_VALUE = new RegExp(
  `${STRONG_LABEL}(?:${SP}*([:=])${SP}*|${SP}+(?:(?:ist|lautet|is)${SP}+)?)(${TOKEN})`,
  'gi'
)
/**
 * A word that MAY introduce a credential („Projektserver-Zugang: …", „Login
 * Planserver: …"): what follows its colon on the line (group 1) is searched for
 * a token only a password looks like.
 */
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

/** A label of an identity or tax number (group 1: what follows on its line). */
const IDENTITY_LABEL = new RegExp(
  `(?:steuernummer|steuer-?nr|(?<![${WORD}])st\\.?-?nr|personalausweis|reisepass|ausweisn(?:ummer|r)` +
    '|passn(?:ummer|r)|f(?:ü|ue)hrerschein|sozialversicherungsn(?:ummer|r)' +
    `|(?<![${WORD}])sv-?n(?:ummer|r))([^\\r\\n]{0,40})`,
  'gi'
)
const IDENTITY_MIN_DIGITS = 6
/**
 * A US social-security number as it is written, with its dashes. It has no
 * checksum, so the unbroken nine digits are not counted: that is any order,
 * article or file number.
 */
const US_SSN = /(?<![0-9-])[0-9]{3}-[0-9]{2}-[0-9]{4}(?![0-9-])/

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/
/**
 * A date is a run of digits with separators too, and a deadline written
 * 12/03/2027 is precisely what a project memory exists to carry: blanked
 * before a phone number is looked for.
 */
const DATE_SHAPE = /(?<![0-9])(?:[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/g
/**
 * A number someone can call says so: an international prefix, a trunk zero, or
 * a label. A bare run of digit groups is a drawing number, a dimension chain or
 * an article number far more often than a phone number in a planning office.
 */
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

/** A token as the value it holds: opening quotes and closing punctuation taken off. */
const valueOf = (token: string): string => token.replace(LEADING_QUOTES, '').replace(TRAILING_MARKS, '')

/** Whether the value holds a lower-case letter, an upper-case one, a digit, a sign a password carries. */
function characterClasses(value: string): [boolean, boolean, boolean, boolean] {
  return [count(LOWER, value) > 0, count(UPPER, value) > 0, count(DIGIT, value) > 0, STRONG_SIGNS.test(value)]
}

/** Whether the token after a credential's label is its value, not the next word of the sentence. */
function isLabelledPassword(token: string, explicit: boolean): boolean {
  const value = valueOf(token)
  if (value.length < 4 || URL_START.test(value)) return false
  if (explicit && ALL_DIGITS.test(value)) return true
  const classes = characterClasses(value)
  return (classes[2] || classes[3]) && classes.filter(Boolean).length >= 2
}

/** Whether a token after a login's label can only be a password: a letter, a digit and a sign. */
function isUnlabelledPassword(token: string): boolean {
  const value = valueOf(token)
  if (value.length < 6 || URL_START.test(value) || EMAIL_TOKEN.test(value)) return false
  const [lower, upper, digit, sign] = characterClasses(value)
  return (lower || upper) && digit && sign
}

/** Whether a long run holds a stretch no word or file name has: 24 characters, six digits and six letters. */
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

/** The kind of secret a note holds, or null. */
export function secretKind(content: string): SecretKind | null {
  const [span] = findSpans(content, DETECTORS_ONLY)
  // No terms in the rules, so a span's kind is always a detector's.
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

/** The kind of contact detail a note holds, or null. */
export function contactKind(content: string): ContactKind | null {
  if (EMAIL.test(content)) return 'email'
  const scrubbed = content.replace(DATE_SHAPE, ' ')
  const unlabelled = [...(scrubbed.match(PHONE_INTERNATIONAL) ?? []), ...(scrubbed.match(PHONE_NATIONAL) ?? [])]
  if (unlabelled.some((found) => digitsBetween(found, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS))) return 'phone'
  const labelled = scrubbed.match(PHONE_LABELLED) ?? []
  if (labelled.some((found) => digitsBetween(found, LABELLED_PHONE_MIN_DIGITS, PHONE_MAX_DIGITS))) return 'phone'
  return null
}

/** Why a note may not be stored, as the kind found, or null: a secret anywhere, a contact on a shared shelf. */
export function noteRefusal(content: string, shared: boolean): NoteRefusalKind | null {
  return secretKind(content) ?? (shared ? contactKind(content) : null)
}

/**
 * Refuse a note that may not be stored (400). `refuseContact` is the shared
 * shelves' extra rule (ADR-0180): a way to reach a person is not written into
 * memory other people read. The message names the kind of thing found and
 * never repeats it.
 */
export function assertStorableNote(content: string, options: { refuseContact: boolean }): void {
  const kind = noteRefusal(content, options.refuseContact)
  if (!kind) return
  const where = SECRET_KINDS.includes(kind as SecretKind) ? 'A memory note' : 'A note in shared memory'
  throw new BadRequestError(
    `${where} cannot hold ${KIND_NAMES[kind]}. Nothing was saved: leave it out and save the note again.`
  )
}
