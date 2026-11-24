// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { callsTo, parseSource, productionSources, parseSourceText } from '@/test-utils/source-ast'

const ENTRY = 'readConversationAudience'

const RATCHET: Readonly<Record<string, number>> = {
  'bff/conversation-context/audience.ts': 1,
  'bff/conversations/cross-project-use.ts': 1,
  'bff/conversations/restricted-use.ts': 1,
}

function callSites(): Record<string, number> {
  const found: Record<string, number> = {}
  for (const file of productionSources()) {
    const count = callsTo(parseSource(file), ENTRY).length
    if (count > 0) found[file] = count
  }
  return found
}

describe('who reads a conversation’s audience (ADR-0192)', () => {
  it('is the context module and the writers that hold the audience lock, and no new caller', () => {
    const found = callSites()
    for (const [file, count] of Object.entries(found)) {
      expect(RATCHET[file], `${file} reads the audience ${count} time(s); go through @/lib/conversation-context`).toBeDefined()
      expect(count, `${file} gained an audience read; the ratchet only shrinks`).toBeLessThanOrEqual(RATCHET[file] ?? 0)
    }
  })

  it('reads it in the locked writers only after taking the lock', () => {
    for (const file of ['bff/conversations/cross-project-use.ts', 'bff/conversations/restricted-use.ts']) {
      const text = parseSource(file).getFullText()
      const read = text.indexOf(`${ENTRY}(tx`)
      expect(read, `${file} reads the audience outside a transaction`).toBeGreaterThan(-1)
      expect(text.lastIndexOf('lockConversationAudience(tx', read), `${file} reads before it locks`).toBeGreaterThan(-1)
    }
  })

  it('catches a new caller', () => {
    const source = parseSourceText(`async function x() { await ${ENTRY}(db, org, id) }`)
    expect(callsTo(source, ENTRY)).toHaveLength(1)
  })
})
