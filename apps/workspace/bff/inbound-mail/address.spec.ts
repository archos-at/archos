/**
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_PART,
  formatInboundAddress,
  inboundMailDomain,
  inboundMailLocalPart,
  mintToken,
  parseInboundAddress,
  projectSlug,
  REDACTED_TOKEN,
  redactProjectAddresses,
  TOKEN_PATTERN,
} from './address'

const DOMAIN = 'inbox.example-post.org'

const token = (value: string) => ({ kind: 'token', token: value })

describe('parseInboundAddress', () => {
  it('takes the token after the slug in the subaddress', () => {
    expect(parseInboundAddress(`project+wohnbau-hietzing.abcdefgh2345@${DOMAIN}`, DOMAIN)).toEqual(token('abcdefgh2345'))
  })

  it('accepts a bare token (empty slug)', () => {
    expect(parseInboundAddress(`project+abcdefgh2345@${DOMAIN}`, DOMAIN)).toEqual(token('abcdefgh2345'))
  })

  it('lowercases the local part, the subaddress and the domain', () => {
    expect(parseInboundAddress(`PROJECT+Wohnbau.ABCDEFGH2345@Inbox.Example-Post.ORG`, DOMAIN)).toEqual(token('abcdefgh2345'))
  })

  it('lowercases ASCII only: a Kelvin sign or dotted capital I is not a letter of the token', () => {
    expect(parseInboundAddress(`project+wohnbau.abcdefgh234\u212a@${DOMAIN}`, DOMAIN)).toEqual({ kind: 'malformed' })
    expect(parseInboundAddress(`project+wohnbau.\u0130bcdefgh2345@${DOMAIN}`, DOMAIN)).toEqual({ kind: 'malformed' })
  })

  it('takes the segment after the LAST dot, whatever sits in the slug position', () => {
    // A slug never contains a dot, but a hand-typed address may; only the
    // token resolves, so the rest is ignored rather than refused.
    expect(parseInboundAddress(`project+a.b.wohnbau.abcdefgh2345@${DOMAIN}`, DOMAIN)).toEqual(token('abcdefgh2345'))
    // …and a slug that happens to LOOK like a token is not the token.
    expect(parseInboundAddress(`project+zzzzzzzzzzzz.abcdefgh2345@${DOMAIN}`, DOMAIN)).toEqual(token('abcdefgh2345'))
  })

  it('reads a quoted local part', () => {
    expect(parseInboundAddress(`"project+wohnbau.abcdefgh2345"@${DOMAIN}`, DOMAIN)).toEqual(token('abcdefgh2345'))
  })

  it('matches the configured local part, whole and case-insensitively', () => {
    expect(parseInboundAddress(`Projekt+wohnbau.abcdefgh2345@${DOMAIN}`, DOMAIN, 'projekt')).toEqual(token('abcdefgh2345'))
    expect(parseInboundAddress(`project+wohnbau.abcdefgh2345@${DOMAIN}`, DOMAIN, 'projekt')).toEqual({ kind: 'malformed' })
  })

  it('calls a foreign domain foreign, including the parent domain and a lookalike', () => {
    expect(parseInboundAddress('project+wohnbau.abcdefgh2345@example.com', DOMAIN)).toEqual({ kind: 'foreign' })
    expect(parseInboundAddress('project+wohnbau.abcdefgh2345@example-post.org', DOMAIN)).toEqual({ kind: 'foreign' })
    expect(parseInboundAddress(`project+wohnbau.abcdefgh2345@evil.${DOMAIN}`, DOMAIN)).toEqual({ kind: 'foreign' })
    expect(parseInboundAddress(`project+wohnbau.abcdefgh2345@${DOMAIN}.evil.com`, DOMAIN)).toEqual({ kind: 'foreign' })
    expect(parseInboundAddress('no-at-sign', DOMAIN)).toEqual({ kind: 'foreign' })
    expect(parseInboundAddress('', DOMAIN)).toEqual({ kind: 'foreign' })
  })

  it('calls an address in our domain without a well-formed token malformed', () => {
    for (const recipient of [
      `@${DOMAIN}`,
      `project@${DOMAIN}`,
      `project+@${DOMAIN}`,
      `project+wohnbau.@${DOMAIN}`,
      `wohnbau.abcdefgh2345@${DOMAIN}`, // no subaddress: the form before the subdomain move
      `q+wohnbau.abcdefgh2345@${DOMAIN}`, // another local part
      `p+wohnbau.abcdefgh2345@${DOMAIN}`, // p, the default local part before project
      `+abcdefgh2345@${DOMAIN}`, // an empty local part
      `project+wohnbau.abcdefgh234@${DOMAIN}`, // 11 characters
      `project+wohnbau.abcdefgh23456@${DOMAIN}`, // 13 characters
      `project+wohnbau.abcdefgh2301@${DOMAIN}`, // 0 and 1 are not base32
      `project+wohnbau.abcdefgh234!@${DOMAIN}`,
      `project+wohnbau.abcdefgh2345+plaene@${DOMAIN}`, // a second + lands in the token position
    ]) {
      expect(parseInboundAddress(recipient, DOMAIN), recipient).toEqual({ kind: 'malformed' })
    }
  })

  it('calls everything foreign when no domain is configured', () => {
    expect(parseInboundAddress(`project+abcdefgh2345@${DOMAIN}`, '')).toEqual({ kind: 'foreign' })
  })

  it('tolerates angle brackets and whitespace around the recipient', () => {
    expect(parseInboundAddress(` <project+abcdefgh2345@${DOMAIN}> `, DOMAIN)).toEqual(token('abcdefgh2345'))
  })
})

describe('mintToken', () => {
  it('is 12 characters of lowercase base32', () => {
    for (let i = 0; i < 200; i += 1) expect(mintToken()).toMatch(TOKEN_PATTERN)
  })

  it('maps each random byte to one letter by its low five bits', () => {
    expect(mintToken(() => Buffer.alloc(12, 0))).toBe('aaaaaaaaaaaa')
    expect(mintToken(() => Buffer.alloc(12, 0xff))).toBe('777777777777')
    expect(mintToken(() => Buffer.from([0, 1, 25, 26, 31, 32, 33, 63, 64, 224, 255, 7]))).toBe('abz27ab7aa7h')
  })

  it('reads exactly twelve bytes', () => {
    const sizes: number[] = []
    mintToken((size) => {
      sizes.push(size)
      return Buffer.alloc(size)
    })
    expect(sizes).toEqual([12])
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => mintToken()))
    expect(seen.size).toBe(1000)
  })
})

describe('projectSlug', () => {
  it('latinizes and hyphenates the project name', () => {
    expect(projectSlug('Wohnbau Hietzing')).toBe('wohnbau-hietzing')
    expect(projectSlug('Straßenbau Süd / Los 2')).toBe('strassenbau-sued-los-2')
  })

  it('never contains a dot, and is at most 30 characters without a trailing hyphen', () => {
    const slug = projectSlug('Sanierung Schule Am.Park.Weg Bauteil A und B und C')
    expect(slug).not.toContain('.')
    expect(slug.length).toBeLessThanOrEqual(30)
    expect(slug).toMatch(/^[a-z0-9-]*[a-z0-9]$/)
  })

  it('is empty for a name with nothing Latin in it', () => {
    expect(projectSlug('東京プロジェクト')).toBe('')
  })

  it('spells the letters Unicode cannot decompose, as every other filename does (fileSlug)', () => {
    expect(projectSlug('Øresund Łódź')).toBe('oeresund-lodz')
  })
})

describe('formatInboundAddress', () => {
  it('puts slug and token, or the token alone, in the subaddress of the local part', () => {
    expect(formatInboundAddress('wohnbau', 'abcdefgh2345', 'Inbox.Example-Post.org')).toBe(
      'project+wohnbau.abcdefgh2345@inbox.example-post.org'
    )
    expect(formatInboundAddress('', 'abcdefgh2345', DOMAIN)).toBe(`project+abcdefgh2345@${DOMAIN}`)
    expect(formatInboundAddress('wohnbau', 'abcdefgh2345', DOMAIN, 'Projekt')).toBe(`projekt+wohnbau.abcdefgh2345@${DOMAIN}`)
  })

  it('round-trips through the parser', () => {
    const minted = mintToken()
    const address = formatInboundAddress(projectSlug('Wohnbau Hietzing'), minted, DOMAIN)
    expect(parseInboundAddress(address, DOMAIN)).toEqual(token(minted))
  })
})

describe('redactProjectAddresses', () => {
  const other = `project+nachbar.zzzzzzzzzzzz@${DOMAIN}`
  const ours = `project+wohnbau.abcdefgh2345@${DOMAIN}`

  it("redacts another project's token and keeps its local part, slug and the domain", () => {
    expect(redactProjectAddresses(`Bitte auch an ${other} schicken.`, DOMAIN, 'abcdefgh2345')).toBe(
      `Bitte auch an project+nachbar.${REDACTED_TOKEN}@${DOMAIN} schicken.`
    )
  })

  it('keeps the receiving token when asked, and redacts it when not (a filed entry)', () => {
    expect(redactProjectAddresses(`An: ${ours}`, DOMAIN, 'abcdefgh2345')).toBe(`An: ${ours}`)
    expect(redactProjectAddresses(`An: ${ours}`, DOMAIN)).toBe(`An: project+wohnbau.${REDACTED_TOKEN}@${DOMAIN}`)
  })

  it('finds a token however the address is dressed: case, quotes, angle brackets, a bare token', () => {
    const text = [
      `<PROJECT+Nachbar.ZZZZZZZZZZZZ@Inbox.Example-Post.ORG>`,
      `"project+nachbar.zzzzzzzzzzzz"@${DOMAIN}`,
      `project+zzzzzzzzzzzz@${DOMAIN}.`,
    ].join(' ')
    expect(redactProjectAddresses(text, DOMAIN)).not.toContain('zzzzzzzzzzzz')
    expect(redactProjectAddresses(`project+zzzzzzzzzzzz@${DOMAIN}`, DOMAIN)).toBe(`project+${REDACTED_TOKEN}@${DOMAIN}`)
  })

  it('leaves addresses that are not project addresses, and other domains, alone', () => {
    const text = `kontakt@${DOMAIN}, q+nachbar.zzzzzzzzzzzz@${DOMAIN}, project+nachbar.zzzzzzzzzzzz@example.com, a@b`
    expect(redactProjectAddresses(text, DOMAIN)).toBe(text)
  })

  it('matches the domain as a whole host: a longer label is foreign, a trailing dot or subdomain keeps its rest', () => {
    const lookalike = `project+nachbar.zzzzzzzzzzzz@${DOMAIN}x.com`
    expect(redactProjectAddresses(lookalike, DOMAIN)).toBe(lookalike)
    expect(redactProjectAddresses(`an ${other}.`, DOMAIN)).toBe(`an project+nachbar.${REDACTED_TOKEN}@${DOMAIN}.`)
    expect(redactProjectAddresses(`project+nachbar.zzzzzzzzzzzz@${DOMAIN.toUpperCase()}.evil.example`, DOMAIN)).toBe(
      `project+nachbar.${REDACTED_TOKEN}@${DOMAIN}.evil.example`
    )
  })

  it('never yields something that parses as a project address', () => {
    const redacted = redactProjectAddresses(other, DOMAIN)
    expect(parseInboundAddress(redacted, DOMAIN).kind).toBe('malformed')
  })

  it('is linear on a long run without an @ (bounded local part)', () => {
    const run = 'a'.repeat(200_000)
    expect(redactProjectAddresses(`${run} ${other}`, DOMAIN)).toBe(`${run} project+nachbar.${REDACTED_TOKEN}@${DOMAIN}`)
    expect(redactProjectAddresses(`${run}@${DOMAIN}`, DOMAIN)).toBe(`${run}@${DOMAIN}`)
  })

  it('does nothing without a domain', () => {
    expect(redactProjectAddresses(other, '')).toBe(other)
  })
})

describe('inboundMailDomain', () => {
  it('is null when unset or blank, and lowercased otherwise', () => {
    expect(inboundMailDomain({})).toBeNull()
    expect(inboundMailDomain({ INBOUND_MAIL_DOMAIN: '  ' })).toBeNull()
    expect(inboundMailDomain({ INBOUND_MAIL_DOMAIN: ' Inbox.Example-Post.ORG ' })).toBe(DOMAIN)
  })
})

describe('inboundMailLocalPart', () => {
  it('defaults to project when unset or blank, and is lowercased otherwise', () => {
    expect(DEFAULT_LOCAL_PART).toBe('project')
    expect(inboundMailLocalPart({})).toBe(DEFAULT_LOCAL_PART)
    expect(inboundMailLocalPart({ INBOUND_MAIL_LOCAL_PART: ' ' })).toBe(DEFAULT_LOCAL_PART)
    expect(inboundMailLocalPart({ INBOUND_MAIL_LOCAL_PART: ' Projekt ' })).toBe('projekt')
  })

  it.each(['p+x', 'p.x', '-p', 'p-', 'p x', 'ä', 'a'.repeat(33)])('refuses %s, which no address could match', (value) => {
    expect(() => inboundMailLocalPart({ INBOUND_MAIL_LOCAL_PART: value })).toThrow(/INBOUND_MAIL_LOCAL_PART/)
  })
})

/** The address contract the Email Worker routes on (see its `$comment`). */
interface AddressContract {
  localPart: string
  domain: string
  tokenPattern: string
  cases: { recipient: string; project: boolean; note?: string }[]
}

function loadAddressContract(): AddressContract {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'contracts', 'inbound-address.json')
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')) as AddressContract
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`contracts/inbound-address.json not found above ${process.cwd()}`)
    dir = parent
  }
}

describe('the address contract with the Email Worker (contracts/inbound-address.json)', () => {
  const contract = loadAddressContract()

  it('uses the same token pattern', () => {
    // The Worker refuses anything that fails this shape without asking the
    // BFF, so a pattern changed on one side only drops or misroutes mail.
    expect(TOKEN_PATTERN.source).toBe(contract.tokenPattern)
  })

  it.each(contract.cases)('parses $recipient as a project address: $project', ({ recipient, project }) => {
    expect(parseInboundAddress(recipient, contract.domain, contract.localPart).kind === 'token').toBe(project)
  })

  it('defaults to the contract\'s local part', () => {
    expect(DEFAULT_LOCAL_PART).toBe(contract.localPart)
  })

  it('mints only addresses the Worker routes to the BFF', () => {
    const pattern = new RegExp(contract.tokenPattern)
    for (let i = 0; i < 200; i += 1) {
      const address = formatInboundAddress(projectSlug('Wohnbau Hietzing Bauteil 2'), mintToken(), contract.domain, contract.localPart)
      expect(address.startsWith(`${contract.localPart}+`)).toBe(true)
      expect(address.endsWith(`@${contract.domain}`)).toBe(true)
      const local = address.slice(0, address.lastIndexOf('@'))
      expect(local.slice(local.lastIndexOf('.') + 1)).toMatch(pattern)
    }
  })
})
