/**
 * @vitest-environment node
 */
/**
 * The Worker ↔ webhook contract is held to `contracts/inbound-mail-contract.json`,
 * which the Email Worker's spec reads too: a value changed on one side only
 * would bounce mail the webhook meant to hold, or retry mail it meant to bounce.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decodeEnvelopeAddress,
  deliveryOutcome,
  DROPPED_REASONS,
  ENVELOPE_FROM_HEADER,
  ENVELOPE_TO_HEADER,
  INBOUND_MAIL_WEBHOOK_PATH,
  INBOUND_SENDER_TRUSTS,
  MAX_RAW_MESSAGE_BYTES,
  NULL_SENDER,
  NOT_STAGED_REASONS,
  PART_RISK_FLAGS,
  REJECT_TEXT_TEMPLATE,
  REJECT_TEXT_WITHOUT_SITE,
  rejectText,
  SITE_PLACEHOLDER,
  SENDER_FLAGS,
  SENDER_REASONS,
  SIGNATURE_LIFETIME_SECONDS,
  SIGNED_COMPONENTS,
  VERDICT_HEADER,
  VERDICT_REJECT,
  type DeliveryOutcome,
} from './contract'
import { PUBLIC_SITE_ORIGIN_MAX_LENGTH, PUBLIC_SITE_PATHS } from '@/shared/public-site'

interface VerdictContract {
  path: string
  envelopeToHeader: string
  envelopeFromHeader: string
  verdictHeader: string
  verdictReject: string
  maxRawMessageBytes: number
  signedComponents: string[]
  signatureLifetimeSeconds: number
  rejectText: {
    template: string
    placeholder: string
    siteMaxLength: number
    withoutSite: string
    cases: { site: string | null; text: string; note?: string }[]
  }
  envelopeEncoding: { nullSender: string; cases: { address: string; header: string }[] }
  cases: { status: number; verdict: string | null; outcome: DeliveryOutcome; note?: string }[]
}

function loadContract(): VerdictContract {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'contracts', 'inbound-mail-contract.json')
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')) as VerdictContract
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`contracts/inbound-mail-contract.json not found above ${process.cwd()}`)
    dir = parent
  }
}

describe('the verdict contract with the Email Worker (contracts/inbound-mail-contract.json)', () => {
  const contract = loadContract()

  it('names the same path, headers, size bound, signed components and lifetime', () => {
    expect({
      path: INBOUND_MAIL_WEBHOOK_PATH,
      envelopeToHeader: ENVELOPE_TO_HEADER,
      envelopeFromHeader: ENVELOPE_FROM_HEADER,
      verdictHeader: VERDICT_HEADER,
      verdictReject: VERDICT_REJECT,
      maxRawMessageBytes: MAX_RAW_MESSAGE_BYTES,
      signedComponents: [...SIGNED_COMPONENTS],
      signatureLifetimeSeconds: SIGNATURE_LIFETIME_SECONDS,
      rejectText: [REJECT_TEXT_TEMPLATE, SITE_PLACEHOLDER, PUBLIC_SITE_ORIGIN_MAX_LENGTH, REJECT_TEXT_WITHOUT_SITE],
    }).toEqual({
      path: contract.path,
      envelopeToHeader: contract.envelopeToHeader,
      envelopeFromHeader: contract.envelopeFromHeader,
      verdictHeader: contract.verdictHeader,
      verdictReject: contract.verdictReject,
      maxRawMessageBytes: contract.maxRawMessageBytes,
      signedComponents: contract.signedComponents,
      signatureLifetimeSeconds: contract.signatureLifetimeSeconds,
      rejectText: [
        contract.rejectText.template,
        contract.rejectText.placeholder,
        contract.rejectText.siteMaxLength,
        contract.rejectText.withoutSite,
      ],
    })
  })

  it.each(contract.cases)('reads $status with verdict $verdict as $outcome', ({ status, verdict, outcome }) => {
    expect(deliveryOutcome(status, verdict)).toBe(outcome)
  })

  it('spells the null sender as the Worker writes it', () => {
    expect(NULL_SENDER).toBe(contract.envelopeEncoding.nullSender)
  })

  it.each(contract.envelopeEncoding.cases)('decodes the envelope header $header back to "$address"', ({ address, header }) => {
    expect(decodeEnvelopeAddress(header)).toBe(address)
  })

  it('throws on a malformed escape, which the route answers without the verdict', () => {
    expect(() => decodeEnvelopeAddress('zo%C3@example.org')).toThrow(URIError)
  })
})

describe('rejectText', () => {
  const contract = loadContract()

  it.each(contract.rejectText.cases)('renders the website origin $site as the Worker does ($note)', ({ site, text }) => {
    expect(rejectText(site)).toBe(text)
  })

  it('links the German help and privacy pages of contracts/public-site.json', () => {
    expect(REJECT_TEXT_TEMPLATE).toContain(`Help: ${SITE_PLACEHOLDER}${PUBLIC_SITE_PATHS.projectMail.de}`)
    expect(REJECT_TEXT_TEMPLATE).toContain(`Privacy: ${SITE_PLACEHOLDER}${PUBLIC_SITE_PATHS.privacy.de}`)
  })

  it.each([REJECT_TEXT_TEMPLATE, REJECT_TEXT_WITHOUT_SITE])('is ASCII and names no reason, so a bounce teaches a guesser nothing: %s', (text) => {
    expect(text).toMatch(/^[\x20-\x7e]+$/)
    expect(text).not.toMatch(/token|flag|disabled|deleted|switched/i)
  })
})

describe('the vocabularies', () => {
  it.each([
    ['INBOUND_SENDER_TRUSTS', INBOUND_SENDER_TRUSTS],
    ['SENDER_REASONS', SENDER_REASONS],
    ['SENDER_FLAGS', SENDER_FLAGS],
    ['PART_RISK_FLAGS', PART_RISK_FLAGS],
    ['NOT_STAGED_REASONS', NOT_STAGED_REASONS],
    ['DROPPED_REASONS', DROPPED_REASONS],
  ])('%s holds distinct snake_case English tokens, as the database CHECKs them', (_name, tuple) => {
    expect(new Set(tuple).size).toBe(tuple.length)
    for (const token of tuple) expect(token).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})
