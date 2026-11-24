// @disk-inputs: tests/fixtures/conversation-decision.schema.json
/**
 * @vitest-environment node
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { closedContext } from './types'
import {
  CONVERSATION_DECISION_WIRE_SCHEMAS,
  TURN_DECISION_MAX_AGE_MS,
  conversationDecisionJsonSchema,
  decisionOf,
  signDecision,
  verifyDecision,
} from './wire'

const FIXTURE = join(process.cwd(), 'tests/fixtures/conversation-decision.schema.json')
const SECRET = 'test-secret'
const NOW = 1_795_600_000_000
const ANSWER = '5a5a5a5a-0000-4000-8000-000000000001'

function decided() {
  const context = closedContext('chat', 's_conv_1')
  return decisionOf(
    {
      ...context,
      audience: { ...context.audience, solo: true, version: 0 },
      may: {
        ...context.may,
        shelves: [{ collection: 'oib_knowledge', shelf: 'base', countries: ['AT'] }],
        personalMemory: true,
        personalShelf: true,
        projectMemory: { readableFolderIds: ['folder-only-the-bff-sees'] },
        workspaceRead: 'all',
      },
    },
    ANSWER,
    NOW,
  )
}

describe('the conversation decision on the wire', () => {
  it('matches the committed fixture the Python tier parses', () => {
    const generated = `${JSON.stringify(conversationDecisionJsonSchema(), null, 2)}\n`
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, generated, 'utf8')
    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The decision schema changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture in the same change.',
    ).toBe(generated)
  })

  it('exports every schema the contract map names', () => {
    expect(Object.keys(conversationDecisionJsonSchema().$defs as object).sort()).toEqual(
      Object.keys(CONVERSATION_DECISION_WIRE_SCHEMAS).sort(),
    )
  })

  it('keeps project memory in the BFF, and carries version 0 as 0, not as a missing row', () => {
    const body = decided()
    expect(body.may).not.toHaveProperty('projectMemory')
    expect(body.audienceVersion).toBe(0)
  })

  it('verifies what it signed, within thirty minutes', () => {
    const signed = signDecision(decided(), SECRET)
    expect(verifyDecision(signed.header, signed.signature, SECRET, NOW + 60_000)).toEqual(decided())
    expect(verifyDecision(signed.header, signed.signature, SECRET, NOW + TURN_DECISION_MAX_AGE_MS + 1)).toBeNull()
  })

  it('refuses an unsigned, re-signed, tampered or unparsable decision', () => {
    const signed = signDecision(decided(), SECRET)
    const tampered = Buffer.from(
      JSON.stringify({ ...decided(), may: { ...decided().may, personalMemory: false, workspaceRead: 'all', shelves: [] } }),
    ).toString('base64url')
    expect(verifyDecision(signed.header, null, SECRET, NOW)).toBeNull()
    expect(verifyDecision(signed.header, signed.signature, null, NOW)).toBeNull()
    expect(verifyDecision(signed.header, signDecision(decided(), 'other').signature, SECRET, NOW)).toBeNull()
    expect(verifyDecision(tampered, signed.signature, SECRET, NOW)).toBeNull()
    const extra = Buffer.from(JSON.stringify({ ...decided(), extra: true })).toString('base64url')
    const extraSig = signDecision(decided(), SECRET).signature
    expect(verifyDecision(extra, extraSig, SECRET, NOW)).toBeNull()
  })
})
