// @disk-inputs: server.js, bff/turns/turn-headers.js
/**
 * @vitest-environment node
 */
import fixtureData from '../tests/fixtures/request_context.json'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { callsTo, parseSourceText, ts } from '@/test-utils/source-ast'
import { buildRequestContextEnvelopeHeaders as commonJsEnvelopeHeaders, turnContextHeaders } from './turns/turn-headers.js'

import {
  buildRequestContextEnvelope,
  buildRequestContextEnvelopeHeaders,
  buildRequestContextEnvelopePayload,
  buildRequestContextHeaders,
  buildRequestContextWireHeaders,
  encodeBudgetHeader,
  encodeJsonHeader,
  encodeTextHeader,
  encodeModelOverridesHeader,
  REQUEST_CONTEXT_HEADER_NAMES,
  REQUEST_CONTEXT_MAX_AGE_MS,
  signRequestContextEnvelope,
  verifyRequestContextEnvelope,
  type RequestContextInput,
} from './request-context'

interface RequestContextFixtureCase {
  name: string
  comment?: string
  input: RequestContextInput
  headers: Record<string, string>
}

interface RequestContextEnvelopeFixtureCase {
  name: string
  comment?: string
  secret: string
  input: RequestContextInput
  envelopeJson: string
  header: string
  signature: string
}

interface RequestContextFixture {
  cases: RequestContextFixtureCase[]
  envelopeCases: RequestContextEnvelopeFixtureCase[]
}

const fixture: RequestContextFixture = fixtureData as RequestContextFixture

describe('buildRequestContextHeaders — cross-language contract fixture', () => {
  it('the fixture actually has cases (guards against a silently-empty/misresolved fixture path)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(2)
  })

  for (const testCase of fixture.cases) {
    it(`matches the wire contract: ${testCase.name}`, () => {
      expect(buildRequestContextHeaders(testCase.input)).toEqual(testCase.headers)
    })
  }
})

describe('buildRequestContextHeaders — omission rules', () => {
  it('omits every header for an empty input (no org/project/scope at all)', () => {
    expect(buildRequestContextHeaders({})).toEqual({})
  })

  it('omits X-Collection-Scope for an empty array, not an empty-array-encoded header', () => {
    const headers = buildRequestContextHeaders({ collectionScope: [] })
    expect(headers[REQUEST_CONTEXT_HEADER_NAMES.COLLECTION_SCOPE]).toBeUndefined()
  })

  it('omits X-Model-Overrides for an empty object, mirroring "use YAML defaults"', () => {
    const headers = buildRequestContextHeaders({ modelOverrides: {} })
    expect(headers[REQUEST_CONTEXT_HEADER_NAMES.MODEL_OVERRIDES]).toBeUndefined()
  })

  it('omits X-Model-Overrides for null/undefined', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        buildRequestContextHeaders({ modelOverrides: null }),
        REQUEST_CONTEXT_HEADER_NAMES.MODEL_OVERRIDES,
      ),
    ).toBe(false)
  })

  it('omits X-Budget for null, but includes it (even a zeroed snapshot) when present', () => {
    expect(buildRequestContextHeaders({ budget: null })).toEqual({})
    const headers = buildRequestContextHeaders({
      budget: { remainingOrgUsd: 0, remainingUserUsd: 0, remainingProjectUsd: 0 },
    })
    expect(headers[REQUEST_CONTEXT_HEADER_NAMES.BUDGET]).toBeDefined()
  })

  it('omits X-Disabled-Sources for an empty array', () => {
    expect(buildRequestContextHeaders({ disabledSources: [] })).toEqual({})
  })

  it('omits X-Feature-Memory-Reflection only when undefined, not when explicitly false', () => {
    expect(buildRequestContextHeaders({})[REQUEST_CONTEXT_HEADER_NAMES.MEMORY_REFLECTION]).toBeUndefined()
    expect(buildRequestContextHeaders({ memoryReflectionEnabled: false })[REQUEST_CONTEXT_HEADER_NAMES.MEMORY_REFLECTION]).toBe(
      'false',
    )
  })

  it('omits string headers (org/user/project id) for empty-string input, matching the server.js falsy guard', () => {
    const headers = buildRequestContextHeaders({ organizationId: '', userId: '', projectId: '' })
    expect(headers).toEqual({})
  })
})

describe('X-Org-Instructions', () => {
  const BLOCK = 'Zuerst das Ergebnis, dann die Begründung.\nWien annehmen, wenn nichts genannt ist.'

  it('is base64url(utf-8 text), the encoding a multi-line header needs', () => {
    const headers = buildRequestContextHeaders({ orgInstructions: BLOCK })
    const encoded = headers[REQUEST_CONTEXT_HEADER_NAMES.ORG_INSTRUCTIONS]
    expect(encoded).toBe(encodeTextHeader(BLOCK))
    expect(encoded).not.toContain('\n')
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(BLOCK)
  })

  it('survives the umlauts an Austrian office writes', () => {
    const text = 'Immer eine Mängelliste anhängen. Gültig für Grundstücksgrenzen.'
    const headers = buildRequestContextHeaders({ orgInstructions: text })
    expect(Buffer.from(headers[REQUEST_CONTEXT_HEADER_NAMES.ORG_INSTRUCTIONS], 'base64url').toString('utf8')).toBe(text)
  })

  it('is OMITTED when the organization has written none — absent, never empty', () => {
    for (const input of [{}, { orgInstructions: null }, { orgInstructions: '' }]) {
      const headers = buildRequestContextHeaders(input)
      expect(headers[REQUEST_CONTEXT_HEADER_NAMES.ORG_INSTRUCTIONS]).toBeUndefined()
      expect(buildRequestContextEnvelopePayload(input)).not.toHaveProperty('orgInstructions')
    }
  })

  it('does NOT cap the text here — the cap is enforced where the block is written', () => {
    const tooLong = 'a'.repeat(2000)
    const encoded = buildRequestContextHeaders({ orgInstructions: tooLong })[
      REQUEST_CONTEXT_HEADER_NAMES.ORG_INSTRUCTIONS
    ]
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toHaveLength(2000)
  })

  it('rides the signed envelope too, LAST in key order so older payloads stay byte-identical', () => {
    const payload = buildRequestContextEnvelopePayload({
      organizationId: 'org_1',
      issuedAt: 1,
      orgInstructions: BLOCK,
    })
    expect(Object.keys(payload)).toEqual(['organizationId', 'issuedAt', 'orgInstructions'])
  })
})

describe('federalState (backlog T3-9 follow-up, 2026-07-16, user-mandated) — envelope-only', () => {
  it('buildRequestContextHeaders never emits a header for it (no individual X-Grid-Bundesland header)', () => {
    const headers = buildRequestContextHeaders({ federalState: 'vienna' })
    expect(headers).toEqual({})
    expect(Object.keys(headers).some((name) => name.toLowerCase().includes('federalstate'))).toBe(false)
  })

  it('buildRequestContextEnvelopePayload includes it when present', () => {
    expect(buildRequestContextEnvelopePayload({ federalState: 'tyrol' })).toEqual({ federalState: 'tyrol' })
  })

  it('buildRequestContextEnvelopePayload omits it for falsy values', () => {
    expect(buildRequestContextEnvelopePayload({ federalState: null })).toEqual({})
    expect(buildRequestContextEnvelopePayload({ federalState: undefined })).toEqual({})
    expect(buildRequestContextEnvelopePayload({ federalState: '' })).toEqual({})
  })

  it('is appended as the LAST payload key so pre-existing signed cases stay byte-identical', () => {
    const json = JSON.stringify(
      buildRequestContextEnvelopePayload({ organizationId: 'org_1', memoryReflectionEnabled: true, federalState: 'vienna' }),
    )
    expect(json).toBe('{"organizationId":"org_1","memoryReflectionEnabled":true,"federalState":"vienna"}')
  })

  it('buildRequestContextWireHeaders carries it only on the envelope, not the individual headers', () => {
    const wire = buildRequestContextWireHeaders({ organizationId: 'org_1', federalState: 'vienna' }, 'secret')
    const decoded = JSON.parse(Buffer.from(wire[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT], 'base64url').toString('utf8'))
    expect(decoded.federalState).toBe('vienna')
    expect(Object.keys(wire).some((name) => name.toLowerCase().includes('federalstate'))).toBe(false)
  })
})

describe('low-level encoders', () => {
  it('encodeJsonHeader matches Buffer.from(JSON.stringify(x)).toString("base64url")', () => {
    const value = { a: 1, b: ['x', 'y'] }
    expect(encodeJsonHeader(value)).toBe(Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'))
  })

  it('encodeTextHeader matches Buffer.from(x, "utf8").toString("base64url") for multi-line text', () => {
    const text = 'line one\nline two\ncafé'
    expect(encodeTextHeader(text)).toBe(Buffer.from(text, 'utf8').toString('base64url'))
  })

  it('encodeBudgetHeader is a JSON encoding of the snapshot', () => {
    const snapshot = { remainingOrgUsd: 1.5, remainingUserUsd: null, remainingProjectUsd: 2 }
    expect(encodeBudgetHeader(snapshot)).toBe(encodeJsonHeader(snapshot))
  })

  it('encodeModelOverridesHeader is a JSON encoding of the overrides map', () => {
    const overrides = { deep_research: 'openrouter/anthropic/claude-3.7-sonnet' }
    expect(encodeModelOverridesHeader(overrides)).toBe(encodeJsonHeader(overrides))
  })
})

describe('buildRequestContextEnvelope — cross-language contract fixture', () => {
  it('the fixture actually has envelope cases', () => {
    expect(fixture.envelopeCases.length).toBeGreaterThanOrEqual(2)
  })

  for (const testCase of fixture.envelopeCases) {
    it(`matches the signed wire contract: ${testCase.name}`, () => {
      const envelope = buildRequestContextEnvelope(testCase.input, testCase.secret)
      expect(envelope.header).toBe(testCase.header)
      expect(envelope.signature).toBe(testCase.signature)
    })

    it(`the envelope payload JSON matches the fixture's documented envelopeJson: ${testCase.name}`, () => {
      const json = JSON.stringify(buildRequestContextEnvelopePayload(testCase.input))
      expect(json).toBe(testCase.envelopeJson)
    })
  }
})

describe('buildRequestContextEnvelope — omission rules', () => {
  it('an empty input still mints an envelope of "{}" (presence, not omission)', () => {
    const envelope = buildRequestContextEnvelope({}, 'secret')
    expect(envelope.header).toBe(Buffer.from('{}', 'utf8').toString('base64url'))
  })

  it('omits every field the individual-header builder also omits', () => {
    const input: RequestContextInput = {
      organizationId: '',
      collectionScope: [],
      modelOverrides: {},
      disabledSources: [],
      budget: null,
    }
    expect(buildRequestContextEnvelopePayload(input)).toEqual({})
  })
})

describe('buildRequestContextEnvelope — signing', () => {
  const input: RequestContextInput = { organizationId: 'org_1' }

  it('signature is null when no secret is supplied', () => {
    expect(buildRequestContextEnvelope(input, undefined).signature).toBeNull()
    expect(buildRequestContextEnvelope(input, null).signature).toBeNull()
    expect(buildRequestContextEnvelope(input, '').signature).toBeNull()
  })

  it('signature is a deterministic HMAC-SHA256 hex digest of the payload JSON', () => {
    const envelope = buildRequestContextEnvelope(input, 'my-secret')
    const json = JSON.stringify(buildRequestContextEnvelopePayload(input))
    expect(envelope.signature).toBe(signRequestContextEnvelope(json, 'my-secret'))
    expect(envelope.signature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different secrets produce different signatures for the same payload', () => {
    const a = buildRequestContextEnvelope(input, 'secret-a')
    const b = buildRequestContextEnvelope(input, 'secret-b')
    expect(a.signature).not.toBe(b.signature)
    expect(a.header).toBe(b.header) // unsigned payload identical
  })
})

describe('buildRequestContextEnvelopeHeaders', () => {
  it('always sets X-Request-Context, only sets -Sig when signed', () => {
    const unsigned = buildRequestContextEnvelopeHeaders({ organizationId: 'org_1' }, undefined)
    expect(unsigned[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT]).toBeDefined()
    expect(unsigned[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG]).toBeUndefined()

    const signed = buildRequestContextEnvelopeHeaders({ organizationId: 'org_1' }, 'secret')
    expect(signed[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT]).toBeDefined()
    expect(signed[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG]).toBeDefined()
  })
})

describe('buildRequestContextWireHeaders', () => {
  it('dual-writes: contains every individual header AND the envelope', () => {
    const input: RequestContextInput = {
      organizationId: 'org_1',
      userId: 'user_1',
      memoryReflectionEnabled: true,
    }
    const wire = buildRequestContextWireHeaders(input, 'secret')

    expect(wire).toMatchObject(buildRequestContextHeaders(input))
    expect(wire[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT]).toBeDefined()
    expect(wire[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG]).toBeDefined()
  })
})

describe('verifyRequestContextEnvelope', () => {
  const SECRET = 'verify-spec-secret' // pragma: allowlist secret
  const NOW = 1789430400000

  const mint = (input: Parameters<typeof buildRequestContextEnvelope>[0]) =>
    buildRequestContextEnvelope(input, SECRET)

  const valid = () =>
    mint({
      organizationId: 'org_1',
      userId: 'user_1',
      projectId: 'proj_1',
      conversationId: 's_conv_1',
      issuedAt: NOW,
    })

  it('reads the acting identity out of a well-signed, fresh envelope', () => {
    const { header, signature } = valid()
    expect(verifyRequestContextEnvelope(header, signature, SECRET, NOW)).toEqual({
      organizationId: 'org_1',
      userId: 'user_1',
      projectId: 'proj_1',
      conversationId: 's_conv_1',
      issuedAt: NOW,
      collectionScope: [],
    })
  })

  it('reads the signed scope names in both entry shapes (ADR-0047), dropping anything else', () => {
    const { header, signature } = mint({
      organizationId: 'org_1',
      userId: 'user_1',
      collectionScope: ['oib_knowledge', { collection: 'proj_a_r0123456789ab', shelf: 'project' }],
      issuedAt: NOW,
    })
    expect(verifyRequestContextEnvelope(header, signature, SECRET, NOW)?.collectionScope).toEqual([
      'oib_knowledge',
      'proj_a_r0123456789ab',
    ])
  })

  it('refuses a tampered signature', () => {
    const { header, signature } = valid()
    const flipped = (signature![0] === '0' ? '1' : '0') + signature!.slice(1)
    expect(verifyRequestContextEnvelope(header, flipped, SECRET, NOW)).toBeNull()
  })

  it('refuses an envelope signed with another secret', () => {
    const { header, signature } = valid()
    expect(verifyRequestContextEnvelope(header, signature, 'a-different-secret', NOW)).toBeNull()
  })

  it('refuses an edited payload, because the signature covers it', () => {
    const { signature } = valid()
    const tampered = Buffer.from(
      JSON.stringify({ organizationId: 'org_2', userId: 'user_1', issuedAt: NOW }),
      'utf8',
    ).toString('base64url')
    expect(verifyRequestContextEnvelope(tampered, signature, SECRET, NOW)).toBeNull()
  })

  it('refuses a replay once the window has passed, in both directions', () => {
    const { header, signature } = valid()
    expect(
      verifyRequestContextEnvelope(header, signature, SECRET, NOW + REQUEST_CONTEXT_MAX_AGE_MS + 1),
    ).toBeNull()
    expect(
      verifyRequestContextEnvelope(header, signature, SECRET, NOW - REQUEST_CONTEXT_MAX_AGE_MS - 1),
    ).toBeNull()
  })

  it('accepts an envelope at the edge of the window', () => {
    const { header, signature } = valid()
    expect(
      verifyRequestContextEnvelope(header, signature, SECRET, NOW + REQUEST_CONTEXT_MAX_AGE_MS),
    ).not.toBeNull()
  })

  it('refuses an envelope with no issuedAt — fail-closed, unlike the Python reader', () => {
    const { header, signature } = mint({ organizationId: 'org_1', userId: 'user_1' })
    expect(verifyRequestContextEnvelope(header, signature, SECRET, NOW)).toBeNull()
  })

  it('refuses an envelope that names nobody, however well signed', () => {
    const { header, signature } = mint({ collectionScope: ['oib_knowledge'], issuedAt: NOW })
    expect(verifyRequestContextEnvelope(header, signature, SECRET, NOW)).toBeNull()
  })

  it('refuses when no secret is configured, rather than treating that as permission', () => {
    const { header, signature } = valid()
    expect(verifyRequestContextEnvelope(header, signature, '', NOW)).toBeNull()
    expect(verifyRequestContextEnvelope(header, null, SECRET, NOW)).toBeNull()
    expect(verifyRequestContextEnvelope(null, signature, SECRET, NOW)).toBeNull()
  })

  it('refuses a header that is not base64url JSON', () => {
    expect(verifyRequestContextEnvelope('not-json', 'deadbeef', SECRET, NOW)).toBeNull()
  })
})

const decodeEnvelope = (headers: Record<string, string>): Record<string, unknown> =>
  JSON.parse(Buffer.from(headers['x-request-context'], 'base64url').toString('utf8'))

function dottedName(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    const owner = dottedName(node.expression)
    return owner === undefined ? undefined : `${owner}.${node.name.text}`
  }
  return undefined
}

function propertyNames(node: ts.Node | undefined): string[] {
  if (!node || !ts.isObjectLiteralExpression(node)) return []
  return node.properties.flatMap((property) => (property.name && ts.isIdentifier(property.name) ? [property.name.text] : []))
}

describe('turn-headers.js mints the envelope the gateway sends', () => {
  const NOW = 1789430400000
  const SECRET = 'turn-headers-spec-secret' // pragma: allowlist secret

  it('mints the canonical bytes for every field, in the canonical key order', () => {
    const input: RequestContextInput = {
      organizationId: 'org_1',
      userId: 'user_1',
      projectId: 'proj_1',
      collectionScope: ['oib_knowledge'],
      projectContext: 'context',
      projectMemory: 'memory',
      modelOverrides: { shallow_research: 'm' },
      budget: { remainingOrgUsd: 1, remainingUserUsd: 1, remainingProjectUsd: 1 },
      disabledSources: ['web_search'],
      memoryReflectionEnabled: true,
      federalState: 'vienna',
      conversationId: 's_conv_1',
      issuedAt: NOW,
      orgInstructions: 'Zuerst das Ergebnis.',
    }
    const canonical = buildRequestContextEnvelope(input, SECRET)
    const minted = commonJsEnvelopeHeaders(input, SECRET)
    expect(minted).toEqual({
      'x-request-context': canonical.header,
      'x-request-context-sig': canonical.signature,
    })
    expect(Object.keys(decodeEnvelope(minted))).toEqual([
      'organizationId',
      'userId',
      'projectId',
      'collectionScope',
      'projectContext',
      'projectMemory',
      'modelOverrides',
      'budget',
      'disabledSources',
      'memoryReflectionEnabled',
      'federalState',
      'conversationId',
      'issuedAt',
      'orgInstructions',
    ])
  })

  it('mints the bff transport without the prompt blocks, and names the requester last', () => {
    const input: RequestContextInput = {
      organizationId: 'org_1',
      userId: 'user_1',
      projectContext: 'context',
      projectMemory: 'memory',
      orgInstructions: 'Zuerst das Ergebnis.',
      conversationId: 's_conv_1',
      issuedAt: NOW,
      contextTransport: 'bff',
      requester: { name: 'Ada Lovelace', email: null, organizationName: 'Büro Nord' },
    }
    const canonical = buildRequestContextEnvelope(input, SECRET)
    const minted = commonJsEnvelopeHeaders(input, SECRET)
    expect(minted).toEqual({
      'x-request-context': canonical.header,
      'x-request-context-sig': canonical.signature,
    })
    const payload = decodeEnvelope(minted)
    expect(Object.keys(payload)).toEqual(['organizationId', 'userId', 'conversationId', 'issuedAt', 'contextTransport', 'requester'])
    expect(payload.requester).toEqual({ name: 'Ada Lovelace', email: null, organizationName: 'Büro Nord' })
  })

  it('writes the conversation the BFF authorized into the envelope, with the bff transport', () => {
    const headers = turnContextHeaders(
      { header: 'scope', organizationId: 'org_1', userId: 'user_1', conversationId: 's_conv_1' },
      { issuedAt: NOW, secret: SECRET },
    )
    expect(decodeEnvelope(headers)).toMatchObject({ conversationId: 's_conv_1', issuedAt: NOW, contextTransport: 'bff' })
  })

  it('signs the conversation and the mint time, so a signature from another conversation or mint does not verify', () => {
    const mint = (conversationId: string, issuedAt: number) =>
      turnContextHeaders({ header: 'scope', organizationId: 'org_1', userId: 'user_1', conversationId }, { issuedAt, secret: SECRET })
    const headers = mint('s_conv_1', NOW)
    expect(
      verifyRequestContextEnvelope(headers['x-request-context'], headers['x-request-context-sig'], SECRET, NOW),
    ).toMatchObject({ conversationId: 's_conv_1', issuedAt: NOW })
    for (const other of [mint('s_conv_2', NOW), mint('s_conv_1', NOW + 1)]) {
      expect(verifyRequestContextEnvelope(headers['x-request-context'], other['x-request-context-sig'], SECRET, NOW)).toBeNull()
    }
  })

  it('matches the signed bytes for compact capsules and every legacy fixture', () => {
    const serverBuilder = (input: RequestContextInput) => commonJsEnvelopeHeaders(input, 'fixture-secret')
    for (const testCase of fixture.envelopeCases) {
      expect(commonJsEnvelopeHeaders(testCase.input as RequestContextInput, testCase.secret)).toEqual({
        'x-request-context': testCase.header,
        'x-request-context-sig': testCase.signature,
      })
    }
    const input: RequestContextInput = {
      organizationId: 'org_1', userId: 'user_1', projectId: 'project_1',
      conversationId: 's_conv_1', issuedAt: Date.now(), contextTransport: 'bff',
      projectContext: 'ä'.repeat(3101), projectMemory: 'memory'.repeat(2000),
      orgInstructions: 'instructions'.repeat(2000),
    }
    const canonical = buildRequestContextEnvelope(input, 'fixture-secret')
    const serverHeaders = serverBuilder(input)
    expect(serverHeaders['x-request-context']).toBe(canonical.header)
    expect(serverHeaders['x-request-context-sig']).toBe(canonical.signature)
    const payload = JSON.parse(Buffer.from(canonical.header, 'base64url').toString('utf8'))
    expect(payload.contextTransport).toBe('bff')
    expect(Object.keys(payload).at(-1)).toBe('contextTransport')
    for (const field of ['projectContext', 'projectMemory', 'orgInstructions']) {
      expect(payload).not.toHaveProperty(field)
    }
    expect(verifyRequestContextEnvelope(canonical.header, canonical.signature, 'fixture-secret')).toMatchObject({
      organizationId: 'org_1', userId: 'user_1', conversationId: 's_conv_1',
    })
    const wire = buildRequestContextWireHeaders(input, 'fixture-secret')
    for (const name of [REQUEST_CONTEXT_HEADER_NAMES.PROJECT_CONTEXT, REQUEST_CONTEXT_HEADER_NAMES.PROJECT_MEMORY, REQUEST_CONTEXT_HEADER_NAMES.ORG_INSTRUCTIONS]) {
      expect(wire).not.toHaveProperty(name)
    }
    expect(Buffer.byteLength(canonical.header)).toBeLessThan(1000)
  })
})

describe('server.js hands the gateway the scope route data', () => {
  it('calls turnContextHeaders once, with the scope route result and the mint time, never a query parameter', () => {
    const server = parseSourceText(readFileSync(new URL('../server.js', import.meta.url), 'utf8'), 'server.js')
    const calls = callsTo(server, 'turnContextHeaders')
    expect(calls.map((call) => dottedName(call.arguments[0]))).toEqual(['result.data'])
    expect(calls.map((call) => propertyNames(call.arguments[1]))).toEqual([['issuedAt', 'secret']])
  })
})
