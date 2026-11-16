import { describe, it, expect } from 'vitest'
import type { Message } from '@/lib/db/schema/messages'
import { mapServerMessageToChatMessage, mapServerMessagesToChatMessages } from './server-message-mapper'

const serverMessage = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    conversationId: 's_conv_1',
    role: 'user',
    content: 'Hello',
    metadata: {},
    createdAt: '2026-07-01T10:00:00.000Z' as unknown as Date,
    ...overrides,
  }) as Message

describe('mapServerMessageToChatMessage', () => {
  it('maps core fields and parses the ISO timestamp', () => {
    const mapped = mapServerMessageToChatMessage(serverMessage())

    expect(mapped).not.toBeNull()
    expect(mapped!.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(mapped!.role).toBe('user')
    expect(mapped!.content).toBe('Hello')
    expect(mapped!.timestamp).toBeInstanceOf(Date)
    expect(mapped!.timestamp.toISOString()).toBe('2026-07-01T10:00:00.000Z')
  })

  it('uses the persisted messageType from metadata', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { messageType: 'agent_response' } })
    )

    expect(mapped!.messageType).toBe('agent_response')
  })

  it('infers messageType from role when metadata has none (legacy rows)', () => {
    expect(mapServerMessageToChatMessage(serverMessage({ role: 'user' }))!.messageType).toBe('user')
    expect(
      mapServerMessageToChatMessage(serverMessage({ role: 'assistant' }))!.messageType
    ).toBe('agent_response')
  })

  it('ignores an unknown messageType value and falls back to the role', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { messageType: 'not-a-real-type' } })
    )

    expect(mapped!.messageType).toBe('agent_response')
  })

  it('drops system and tool rows the chat window never renders', () => {
    expect(mapServerMessageToChatMessage(serverMessage({ role: 'system' }))).toBeNull()
    expect(mapServerMessageToChatMessage(serverMessage({ role: 'tool' }))).toBeNull()
  })

  it('restores persisted metadata payloads (errorData, cards, data sources, files)', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          messageType: 'error',
          errorData: { errorCode: 'system.unknown', errorMessage: 'boom' },
          cards: [{ type: 'memory_proposal', title: 'Merken?', content: 'REI 90', kind: 'preference' }],
          enabledDataSources: ['web_search'],
          messageFiles: [{ id: 'f1', fileName: 'a.pdf' }],
        },
      })
    )

    expect(mapped!.messageType).toBe('error')
    expect(mapped!.errorData).toEqual({ errorCode: 'system.unknown', errorMessage: 'boom' })
    expect(mapped!.cards).toEqual([
      {
        type: 'memory_proposal',
        title: 'Merken?',
        content: 'REI 90',
        kind: 'preference',
        confidence: 'medium',
        proposal_id: null,
        supersedes: null,
      },
    ])
    expect(mapped!.enabledDataSources).toEqual(['web_search'])
    expect(mapped!.messageFiles).toEqual([{ id: 'f1', fileName: 'a.pdf' }])
  })

  it('holes a stored card the current schema does not know, keeping the rest in place', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          cards: [{ kind: 'from-a-future-build' }, { type: 'memory_proposal', title: 'Merken?', content: 'REI 90', kind: 'preference' }],
        },
      })
    )
    expect(mapped!.cards).toHaveLength(2)
    expect(mapped!.cards?.[0]).toBeUndefined()
    expect(mapped!.cards?.[1]).toMatchObject({ type: 'memory_proposal' })
  })

  it('restores interactive-card decisions so a settled card cannot be re-answered', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          cards: [{ type: 'project_profile_patch' }],
          cardInteractions: {
            'project_profile_patch-0': { decision: 'accepted', decidedAt: '2026-07-28T09:00:00.000Z' },
          },
        },
      })
    )

    expect(mapped!.cardInteractions).toEqual({
      'project_profile_patch-0': { decision: 'accepted', decidedAt: '2026-07-28T09:00:00.000Z' },
    })
  })

  it('drops card decisions that are not in the closed union', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: { cardInteractions: { 'memory_proposal-0': { decision: 'whatever' } } },
      })
    )

    expect(mapped!.cardInteractions).toBeUndefined()
  })

  it('carries the author through, so a colleague’s message stays attributable (spec CC-3)', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'user', authorUserId: 'user_anna' })
    )

    expect(mapped).not.toBeNull()
    expect(mapped!.messageType).toBe('user')
    expect(mapped!.authorUserId).toBe('user_anna')
  })

  it('leaves the author absent on an unattributed row rather than inventing one', () => {
    expect(mapServerMessageToChatMessage(serverMessage({ authorUserId: null }))!.authorUserId).toBeUndefined()
    expect(
      mapServerMessageToChatMessage(serverMessage({ role: 'assistant', authorUserId: null }))!.authorUserId
    ).toBeUndefined()
  })

  it('restores structured mentions and the server’s addressee ruling', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        metadata: {
          messageType: 'user',
          mentions: [{ targetId: 'user_anna', display: 'Anna Berger' }],
          addressees: { agent: false, users: ['user_anna'] },
        },
      })
    )

    expect(mapped!.mentions).toEqual([{ targetId: 'user_anna', display: 'Anna Berger' }])
    expect(mapped!.addressees).toEqual({ agent: false, users: ['user_anna'] })
  })

  it('drops malformed mentions and a malformed addressee set', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        metadata: {
          mentions: [{ display: 'no target' }, 'nonsense', null],
          addressees: { agent: 'yes', users: 'anna' },
        },
      })
    )

    expect(mapped!.mentions).toBeUndefined()
    expect(mapped!.addressees).toBeUndefined()
  })

  it('defaults a mention display to its target id rather than rendering "undefined"', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ metadata: { mentions: [{ targetId: 'user_anna' }] } })
    )

    expect(mapped!.mentions).toEqual([{ targetId: 'user_anna', display: 'user_anna' }])
  })

  it('tolerates a null metadata column', () => {
    const mapped = mapServerMessageToChatMessage(serverMessage({ metadata: null }))

    expect(mapped!.messageType).toBe('user')
    expect(mapped!.errorData).toBeUndefined()
  })

  it('carries the marks of a deleted source folder: the purge’s date and a removal’s (ADR-0088)', () => {
    const drawn = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { sourceDeleted: { folderId: 'f1', at: '2026-10-20T03:00:00.000Z' } } })
    )
    expect(drawn!.sourceDeletedAt).toBe('2026-10-20T03:00:00.000Z')
    expect(drawn!.erasedAt).toBeUndefined()

    const erased = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        content: 'Inhalt entfernt: Quelle gelöscht',
        metadata: { sourceRemoved: { folderId: 'f1', at: '2026-10-21T08:00:00.000Z' } },
      })
    )
    expect(erased!.erasedAt).toBe('2026-10-21T08:00:00.000Z')
    expect(erased!.citations).toBeUndefined()
  })

  it('ignores a mark without a real date', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { sourceDeleted: { at: 'gestern' }, sourceRemoved: 'yes' } })
    )
    expect(mapped!.sourceDeletedAt).toBeUndefined()
    expect(mapped!.erasedAt).toBeUndefined()
  })
})

describe('mapServerMessagesToChatMessages', () => {
  it('maps a history in order and filters unrenderable rows', () => {
    const mapped = mapServerMessagesToChatMessages([
      serverMessage({ id: 'm1', role: 'user', content: 'q' }),
      serverMessage({ id: 'm2', role: 'system', content: 'internal' }),
      serverMessage({ id: 'm3', role: 'assistant', content: 'a' }),
    ])

    expect(mapped.map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('keeps every human author in a multi-author history', () => {
    const mapped = mapServerMessagesToChatMessages([
      serverMessage({ id: 'm1', role: 'user', authorUserId: 'user_me' }),
      serverMessage({ id: 'm2', role: 'user', authorUserId: 'user_anna' }),
      serverMessage({ id: 'm3', role: 'assistant', authorUserId: null }),
      serverMessage({ id: 'm4', role: 'user', authorUserId: 'user_tobias' }),
    ])

    expect(mapped.map((m) => m.authorUserId)).toEqual([
      'user_me',
      'user_anna',
      undefined,
      'user_tobias',
    ])
  })
})

describe('mapServerMessageToChatMessage — the answer’s provenance', () => {
  const provenance = {
    thinkingSteps: [
      {
        id: 's1',
        userMessageId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        timestamp: '2026-07-01T10:00:05.000Z',
        isComplete: true,
        kind: 'sources',
        tool: 'knowledge_search',
        round: 0,
        traceLanes: [
          { key: 'oib', label: 'OIB 2.3', kind: 'building_law', signal: 'law', hitCount: 1, sources: [{ name: 'oib-rl-2.pdf' }] },
        ],
      },
    ],
    answerConfidence: 'high',
    answerConfidenceReason: 'Zwei übereinstimmende Quellen.',
    routingDecision: 'shallow',
    citationsRemoved: { count: 1, reasons: ['ungrounded'] },
    deepResearchJobId: 'job_1',
    showViewReport: true,
  }

  it('restores the derivation in the stored v2 shape', () => {
    const mapped = mapServerMessageToChatMessage(serverMessage({ metadata: { provenance } }))

    expect(mapped!.thinkingSteps).toHaveLength(1)
    const step = mapped!.thinkingSteps![0]
    expect(step).toEqual(provenance.thinkingSteps[0])
  })

  it('drops a step in the pre-v2 shape rather than interpreting it', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        metadata: {
          provenance: {
            thinkingSteps: [
              { id: 's1', userMessageId: 'm1', functionName: 'status:synthesis', displayName: '', category: 'tasks', timestamp: '2026-07-01T10:00:05.000Z', isComplete: true },
            ],
          },
        },
      }),
    )
    expect(mapped!.thinkingSteps).toBeUndefined()
  })

  it('restores a stopped answer as stopped', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { stopped: true } } }),
    )
    expect(mapped!.stopped).toBe(true)
  })

  it('restores the Aufwand the turn ran at, and drops a level this build does not offer', () => {
    const ran = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { reasoningEffort: 'high' } } }),
    )
    expect(ran!.reasoningEffort).toBe('high')
    const stale = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { reasoningEffort: 'none' } } }),
    )
    expect(stale!.reasoningEffort).toBeUndefined()
  })

  it('restores the confidence self-assessment and the routing decision', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance } }),
    )

    expect(mapped!.answerConfidence).toBe('high')
    expect(mapped!.answerConfidenceReason).toBe('Zwei übereinstimmende Quellen.')
    expect(mapped!.routingDecision).toBe('shallow')
    expect(mapped!.citationsRemoved).toEqual({ count: 1, reasons: ['ungrounded'] })
    expect(mapped!.deepResearchJobId).toBe('job_1')
  })

  it('restores the truncation note, so a reloaded answer still says it stopped early', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { ...provenance, researchTruncated: true } } }),
    )

    expect(mapped!.researchTruncated).toBe(true)
  })

  it('does not invent a truncation for an answer that never had one', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance } }),
    )

    expect(mapped!.researchTruncated).toBeUndefined()
  })

  it('restores the retrieval ledger from provenance, so a reload reads the same account', () => {
    const ledger = [
      {
        index: 0,
        key: 'status.retrieval.withQuery',
        tools: ['knowledge_search'],
        corpora: ['knowledge'],
        query: 'Fluchtweglänge GK4',
        docs: [{ name: 'OIB-RL_2.pdf', detail: 'p.12' }],
        new_docs: ['OIB-RL_2.pdf'],
        hits: 1,
        documents: 1,
      },
    ]
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { ...provenance, retrievalLedger: ledger } } }),
    )

    expect(mapped!.retrievalLedger).toEqual([
      {
        index: 0,
        key: 'status.retrieval.withQuery',
        tools: ['knowledge_search'],
        corpora: ['knowledge'],
        query: 'Fluchtweglänge GK4',
        docs: [{ name: 'OIB-RL_2.pdf', detail: 'p.12' }],
        newDocs: ['OIB-RL_2.pdf'],
        hits: 1,
        documents: 1,
      },
    ])
  })

  it('restores the ledger the BFF persisted for a dropped socket, and drops garbage', () => {
    const persisted = {
      index: 1,
      key: 'status.retrieval.clause',
      tools: ['read_passage'],
      corpora: ['knowledge'],
      docs: [{ name: 'OIB-RL_2.pdf' }],
      new_docs: [],
      hits: 1,
      documents: 1,
    }
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { retrieval_ledger: [persisted] } }),
    )
    expect(mapped!.retrievalLedger).toEqual([
      {
        index: 1,
        key: 'status.retrieval.clause',
        tools: ['read_passage'],
        corpora: ['knowledge'],
        docs: [{ name: 'OIB-RL_2.pdf' }],
        newDocs: [],
        hits: 1,
        documents: 1,
      },
    ])

    const bad = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: { retrieval_ledger: 'oib', provenance: { retrievalLedger: [{ key: 'no-index' }] } },
      }),
    )
    expect(bad!.retrievalLedger).toBeUndefined()
  })

  it('restores the quote stamps from either spelling, bounded again', () => {
    const stamp = { text: 'Wände sind in REI 90 auszuführen.', status: 'verbatim', number: 1, file_name: 'oib.pdf', page: 4 }
    const fromProvenance = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { ...provenance, quoteStamps: [stamp] } } }),
    )
    expect(fromProvenance!.quoteStamps).toEqual([
      { text: 'Wände sind in REI 90 auszuführen.', status: 'verbatim', number: 1, fileName: 'oib.pdf', page: 4 },
    ])
    const fromWire = mapServerMessageToChatMessage(serverMessage({ role: 'assistant', metadata: { quote_stamps: [stamp] } }))
    expect(fromWire!.quoteStamps?.[0].status).toBe('verbatim')
    const bad = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { provenance: { quoteStamps: [{ text: 'x', status: 'sure' }] } } }),
    )
    expect(bad!.quoteStamps).toBeUndefined()
  })

  it('restores the answer check, the rule version and the found-nothing flag (ADR-0139)', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          provenance: {
            ...provenance,
            confidenceCheck: { status: 'unavailable', findings: [] },
            answerConfidenceVersion: 2,
            lookupFoundNothing: true,
          },
        },
      }),
    )
    expect(mapped!.confidenceCheck).toEqual({ status: 'unavailable', findings: [] })
    expect(mapped!.answerConfidenceVersion).toBe(2)
    expect(mapped!.lookupFoundNothing).toBe(true)

    const old = mapServerMessageToChatMessage(serverMessage({ role: 'assistant', metadata: { provenance } }))
    expect(old!.answerConfidenceVersion).toBeUndefined()
    expect(old!.confidenceCheck).toBeUndefined()
  })

  it('restores the run ledger on a run’s own message, bounded again on the way out', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          run_ledger: {
            runId: 'run-1',
            status: 'running',
            phases: [{ phase: 'researching', startedAt: '2026-09-16T08:00:00.000Z' }],
            steps: [
              {
                id: 'batch-1',
                phase: 'researching',
                intent: 'OIB-2 auf Fluchtwegbreiten prüfen',
                startedAt: '2026-09-16T08:01:00.000Z',
                docs: [{ name: 'OIB-RL_2.pdf', loci: ['S. 12'] }],
                tool: 'knowledge_search',
              },
            ],
            startedAt: '2026-09-16T08:00:00.000Z',
            updatedAt: '2026-09-16T08:01:00.000Z',
          },
        },
      }),
    )
    expect(mapped!.runLedger?.steps[0]).toEqual({
      id: 'batch-1',
      phase: 'researching',
      intent: 'OIB-2 auf Fluchtwegbreiten prüfen',
      startedAt: '2026-09-16T08:01:00.000Z',
      docs: [{ name: 'OIB-RL_2.pdf', loci: ['S. 12'] }],
    })

    const bad = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { run_ledger: 'lief gut' } }),
    )
    expect(bad!.runLedger).toBeUndefined()
  })

  it('reads the run title back as one bounded line, and drops one that is not a string', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: { run_title: `Normprüfung:\n  Fluchtwege ${'x'.repeat(300)}` },
      }),
    )
    expect(mapped!.runTitle).toMatch(/^Normprüfung: Fluchtwege x+$/)
    expect(mapped!.runTitle).toHaveLength(200)

    const bad = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { run_title: { de: 'Titel' } } }),
    )
    expect(bad!.runTitle).toBeUndefined()
  })

  it('ignores a provenance blob written by some other build', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        metadata: {
          provenance: {
            answerConfidence: 'extremely-high',
            routingDecision: 'sideways',
            thinkingSteps: 'not-an-array',
            citationsRemoved: { count: 'lots' },
          },
        },
      }),
    )

    expect(mapped!.answerConfidence).toBeUndefined()
    expect(mapped!.routingDecision).toBeUndefined()
    expect(mapped!.thinkingSteps).toBeUndefined()
    expect(mapped!.citationsRemoved).toBeUndefined()
  })

  it('adds nothing when the row has no provenance — the pre-ADR-0037 case', () => {
    const mapped = mapServerMessageToChatMessage(serverMessage())

    expect(mapped!.thinkingSteps).toBeUndefined()
    expect(mapped!.answerConfidence).toBeUndefined()
  })

  it('a non-object provenance is ignored rather than throwing', () => {
    for (const value of [null, 'x', 42, []]) {
      const mapped = mapServerMessageToChatMessage(
        serverMessage({ metadata: { provenance: value } }),
      )
      expect(mapped!.thinkingSteps).toBeUndefined()
    }
  })

  it('restores the read-but-uncited disclosure from its own envelope', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          readSources: {
            v: 1,
            sources: [
              {
                document_id: 'doc:oib_knowledge:oib-rl_2.pdf',
                citation_key: 'oib-rl_2.pdf, p.12',
                file_name: 'oib-rl_2.pdf',
                page: 12,
                kind: 'building_law',
                lane: 'building_law_oib',
              },
            ],
          },
        },
      }),
    )

    expect(mapped!.readSources).toHaveLength(1)
    expect(mapped!.readSources![0]).toMatchObject({ fileName: 'oib-rl_2.pdf', page: 12 })
  })

  it('adds no disclosure when the row never recorded one', () => {
    const mapped = mapServerMessageToChatMessage(serverMessage({ role: 'assistant' }))

    expect(mapped!.readSources).toBeUndefined()
  })
})

describe('mapServerMessageToChatMessage — a post-answer stage', () => {
  it('restores the chips a stage wrote onto the answer', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          stages: {
            followUps: {
              items: [{ question: 'Und bei Hanglage?', hint: 'tiefster Geländepunkt' }],
            },
          },
        },
      }),
    )

    expect(mapped!.stages?.followUps?.items).toEqual([
      { question: 'Und bei Hanglage?', hint: 'tiefster Geländepunkt' },
    ])
  })

  it('re-applies the bound to a row an older build wrote', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          stages: {
            followUps: { items: Array(12).fill({ question: 'Noch eine Frage?' }) },
            aStageFromTheFuture: { anything: 'unbounded' },
          },
        },
      }),
    )

    expect(Object.keys(mapped!.stages!)).toEqual(['followUps'])
    expect(mapped!.stages?.followUps?.items).toHaveLength(4)
  })

  it('restores what the reflection stage recorded, so a reload still shows it', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          stages: {
            memoryReflection: {
              items: [
                { id: 'row-1', kind: 'derived_fact', content: 'Das oberste Fluchtniveau beträgt 9,80 m.' },
              ],
            },
          },
        },
      }),
    )

    expect(mapped!.stages?.memoryReflection?.items).toEqual([
      { id: 'row-1', kind: 'derived_fact', content: 'Das oberste Fluchtniveau beträgt 9,80 m.' },
    ])
  })

  it('leaves a message with no stage output without the key at all', () => {
    const mapped = mapServerMessageToChatMessage(serverMessage({ role: 'assistant', metadata: {} }))
    expect(mapped!.stages).toBeUndefined()
  })
})

describe('mapServerMessageToChatMessage — a human-in-the-loop prompt', () => {
  const prompt = {
    promptId: 'p-1',
    promptParentId: 'parent-1',
    promptInputType: 'choice',
    promptOptions: [
      { id: 'b', label: 'Nur Kern B' },
      { id: 'both', label: 'Beide Kerne' },
    ],
    promptPlaceholder: 'Welcher Kern?',
    promptFor: 'user_matthias',
  }

  it('restores the question, its options and who was asked', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({ role: 'assistant', metadata: { messageType: 'prompt', prompt } }),
    )

    expect(mapped!.messageType).toBe('prompt')
    expect(mapped!.promptInputType).toBe('choice')
    expect(mapped!.promptOptions).toEqual([
      { id: 'b', label: 'Nur Kern B' },
      { id: 'both', label: 'Beide Kerne' },
    ])
    expect(mapped!.promptPlaceholder).toBe('Welcher Kern?')
    expect(mapped!.promptFor).toBe('user_matthias')
    expect(mapped!.isPromptResponded).toBeUndefined()
  })

  it('derives isPromptResponded from the stored answer rather than a second field', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          messageType: 'prompt',
          prompt,
          promptState: { response: 'both', respondedAt: '2026-07-01T10:05:00.000Z' },
        },
      }),
    )

    expect(mapped!.promptResponse).toBe('both')
    expect(mapped!.isPromptResponded).toBe(true)
  })

  it('keeps only the two input shapes and options that are `{id, label}`', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: {
          messageType: 'prompt',
          prompt: { ...prompt, promptInputType: 'radio', promptOptions: ['Nur Kern B', { id: 'x' }] },
        },
      }),
    )
    expect(mapped!.promptInputType).toBeUndefined()
    expect(mapped!.promptOptions).toBeUndefined()
  })

  it('ignores an empty answer — that is still a question, not a decision', () => {
    const mapped = mapServerMessageToChatMessage(
      serverMessage({
        role: 'assistant',
        metadata: { messageType: 'prompt', prompt, promptState: { response: '' } },
      }),
    )
    expect(mapped!.isPromptResponded).toBeUndefined()
  })
})
