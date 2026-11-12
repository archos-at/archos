/**
 * @vitest-environment node
 */
/**
 * What a BATCH post to this route costs (ADR-0040 L2).
 *
 * The route factory charges one unit of `DEFAULT_MUTATION_LIMIT` per request,
 * and this endpoint accepts an array. Those two facts together are the hole
 * these tests close: without a cap and a per-message charge, one unit of budget
 * buys arbitrarily many inserts, and the rate limit stops bounding the work the
 * endpoint actually does.
 *
 * So the properties pinned here are about ARITHMETIC, not about the happy path:
 * a batch of N costs N, and an array past the cap is refused by validation
 * before any of it is written.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireAuthorizedSession = vi.fn()
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: () => requireAuthorizedSession(),
}))
vi.mock('server-only', () => ({}))

const createConversationMessages = vi.fn()
const listConversationMessages = vi.fn()
vi.mock('@/lib/conversations/service', () => ({
  createConversationMessages: (...args: unknown[]) => createConversationMessages(...args),
  listConversationMessages: (...args: unknown[]) => listConversationMessages(...args),
}))

const actingReaderIsAgent = vi.fn(() => false)
vi.mock('@/lib/agent-api/acting-session', () => ({ actingReaderIsAgent: () => actingReaderIsAgent() }))
vi.mock('@/lib/conversations/repository', () => ({
  findConversationTenancy: vi.fn(async () => ({ projectId: 'p1' })),
}))
vi.mock('@/lib/projects/repository', () => ({
  findProjectProfile: vi.fn(async () => ({
    version: 1,
    facts: { building_class: { value: 'gk5', confidence: 'confirmed', source: 'onboarding', updatedAt: '' } },
  })),
}))

import {
  DEFAULT_MUTATION_LIMIT,
  MAX_MESSAGES_PER_REQUEST,
  createInProcessStore,
  setLimitStore,
} from '@/lib/limits'
import { GET, POST } from './route'

let orgCounter = 0
/** A distinct org per test, so each starts with a full budget. */
function session() {
  return {
    userId: 'user_me',
    organizationId: `org_${++orgCounter}`,
    organizationMembershipId: 'om_1',
    role: 'member',
    permissions: [],
  }
}

function message(id: string) {
  return { id, role: 'user' as const, content: 'hello' }
}

function post(body: unknown): Request {
  return new Request('https://grid.test/api/conversations/c1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: 'c1' }) }

beforeEach(() => {
  setLimitStore(createInProcessStore())
  requireAuthorizedSession.mockReset()
  requireAuthorizedSession.mockResolvedValue(session())
  createConversationMessages.mockReset()
  createConversationMessages.mockResolvedValue([])
})

afterEach(() => {
  setLimitStore(null)
})

describe('POST /api/conversations/[id]/messages batch metering', () => {
  it('refuses an array longer than the cap without writing any of it', async () => {
    const tooMany = Array.from({ length: MAX_MESSAGES_PER_REQUEST + 1 }, (_, i) =>
      message(`m${i}`)
    )

    const response = await POST(post(tooMany), context)

    expect(response.status).toBe(400)
    // The bound has to bite BEFORE the service runs, or capping the array would
    // only be documentation.
    expect(createConversationMessages).not.toHaveBeenCalled()
  })

  it('accepts an array exactly at the cap', async () => {
    const atCap = Array.from({ length: MAX_MESSAGES_PER_REQUEST }, (_, i) => message(`m${i}`))

    expect((await POST(post(atCap), context)).status).toBe(201)
    expect(createConversationMessages).toHaveBeenCalledTimes(1)
  })

  it('keeps the cap servable against the burst budget', async () => {
    // Charging per message means a maximal batch spends its whole size at once.
    // A cap above the burst clause would therefore document a batch size that
    // is refused every time — a contract the endpoint cannot honour. This is
    // the guard for whoever lowers the burst number later.
    const burst = DEFAULT_MUTATION_LIMIT.burst?.limit ?? DEFAULT_MUTATION_LIMIT.limit
    expect(MAX_MESSAGES_PER_REQUEST).toBeLessThanOrEqual(burst)
  })

  it('charges one unit per message, not one per request', async () => {
    // The burst clause is what a batch would race, so it is the budget to
    // exhaust: N messages must cost the same as N single posts.
    const burst = DEFAULT_MUTATION_LIMIT.burst?.limit ?? DEFAULT_MUTATION_LIMIT.limit
    const batchSize = 10
    const batch = Array.from({ length: batchSize }, (_, i) => message(`m${i}`))

    let spent = 0
    let refused: Response | null = null
    while (spent + batchSize <= burst * 2) {
      const response = await POST(post(batch), context)
      if (response.status === 429) {
        refused = response
        break
      }
      spent += batchSize
    }

    // Had the route charged per REQUEST, `burst` requests would have passed —
    // that is `burst * batchSize` messages, far past where this stops.
    expect(refused).not.toBeNull()
    expect(spent).toBeLessThanOrEqual(burst)
    expect(spent).toBeGreaterThan(burst - batchSize - 1)
  })

  it('still allows a single message posted as a bare object', async () => {
    expect((await POST(post(message('m1')), context)).status).toBe(201)
    expect(createConversationMessages).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      [expect.objectContaining({ id: 'm1' })]
    )
  })
})

/**
 * A stored answer as its reader gets it. The answer is the one live QA found
 * raw (2026-11-12): asked through `agent-ask-create`, read back through
 * `conversation-message-list`, its `[[card:1]]` reached the agent as text,
 * pointing at a card the list does not even carry without `include=metadata`.
 */
describe('GET /api/conversations/[id]/messages: the stored answer by reader', () => {
  const STORED =
    'In Wien beträgt die Mindesthöhe **1,00 m** [1].\n\n[[card:1]]\n\n' +
    'Gebäudeklasse :project[building_class] [Beleg nicht verifiziert].'
  const page = () => ({
    messages: [
      { id: 'q', role: 'user', content: 'Wie hoch? [[card:1]] bleibt, wie getippt.' },
      { id: 'a', role: 'assistant', content: STORED, metadata: { cards: [{ type: 'guardrail_check' }] } },
    ],
    nextCursor: null,
  })
  const read = async () =>
    (await GET(new Request('https://grid.test/api/conversations/c1/messages?include=metadata'), context)).json()

  beforeEach(() => {
    listConversationMessages.mockReset()
    listConversationMessages.mockResolvedValue(page())
    actingReaderIsAgent.mockReset()
  })

  it('hands an agent plain Markdown: no card marker, no binding, no German verifier label', async () => {
    actingReaderIsAgent.mockReturnValue(true)
    const body = await read()
    // The profile prints its value with a no-break space („GK 5“), as the copy button does.
    const answer = (body.messages[1].content as string).replace(/\u00a0/g, ' ')
    expect(answer).not.toMatch(/\[\[card:\d+\]\]/)
    expect(answer).not.toContain(':project[')
    expect(answer).toBe('In Wien beträgt die Mindesthöhe **1,00 m** [1].\n\nGebäudeklasse GK 5 (citation not verified).')
    // A person's words are theirs, and the cards still ride along for whoever asked for them.
    expect(body.messages[0].content).toBe('Wie hoch? [[card:1]] bleibt, wie getippt.')
    expect(body.messages[1].metadata.cards).toHaveLength(1)
  })

  it('keeps the dialect for the browser, which places the card at its marker', async () => {
    actingReaderIsAgent.mockReturnValue(false)
    const body = await read()
    expect(body.messages[1].content).toBe(STORED)
  })
})
