/**
 * @vitest-environment node
 *
 * The scores a decision on a held mail writes (`./suggest-scores`): one
 * the decision score (`DECISION_SCORE_NAME`) per suggested part, one `mail-thread-match` for a matched
 * text, and PostHog's `suggestion_followed`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/langfuse/decision-score', () => ({ recordDecisionScore: vi.fn(async () => {}) }))
vi.mock('@/lib/langfuse/mail-thread-match-score', () => ({ recordMailThreadMatchScore: vi.fn(async () => {}) }))
vi.mock('./repository', () => ({}))
vi.mock('@/lib/authz/folder-access', () => ({ getHiddenFolderIds: vi.fn() }))

import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { recordMailThreadMatchScore } from '@/lib/langfuse/mail-thread-match-score'
import { FILE_PART_ID, FOLDER_ID, PERSON, TEXT_PART_ID, THREAD_ID, filePart, heldMail, textPart } from './__fixtures__/review'
import type { InboundMailSuggestion } from './suggest'
import { scoreMailDecision, type MailDecisionToScore } from './suggest-scores'

const TRACE = 'a'.repeat(32)
const SUGGESTION: InboundMailSuggestion = {
  folderId: FOLDER_ID,
  folderPath: 'Tragwerk',
  newFolder: false,
  documentType: 'Gutachten',
  reason: 'Die Statik.',
}

const input = (patch: Partial<MailDecisionToScore> = {}): MailDecisionToScore => ({
  organizationId: 'org_1',
  decidedBy: PERSON,
  mail: heldMail(),
  parts: [textPart(), filePart({ suggestion: SUGGESTION, suggestionTraceId: TRACE })],
  decision: {
    parts: [{ partId: FILE_PART_ID, folderId: FOLDER_ID, newFolderPath: null, name: 'S-101_C.pdf', documentType: 'Gutachten' }],
    message: { partId: TEXT_PART_ID, text: 'full', thread: { action: 'append', mailThreadId: THREAD_ID } },
  },
  via: 'app',
  folderPathOf: (folderId) => (folderId === FOLDER_ID ? 'Tragwerk' : null),
  threadOf: (threadId) => (threadId === THREAD_ID ? { participantDomains: ['statik-weber.at'] } : null),
  ...patch,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scoreMailDecision', () => {
  it('scores the suggested part on its trace and the matched text, and answers all', () => {
    expect(scoreMailDecision(input())).toBe('all')
    expect(recordDecisionScore).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'inbound_mail_suggestion',
        subjectId: FILE_PART_ID,
        decision: 'accepted',
        traceId: TRACE,
        detail: { folder: 'same', type: 'same' },
      }),
    )
    expect(recordMailThreadMatchScore).toHaveBeenCalledWith(
      expect.objectContaining({
        partId: TEXT_PART_ID,
        choice: { action: 'append', mailThreadId: THREAD_ID },
        via: 'app',
        sender: { senderTrust: 'member_verified', senderFlags: [], signedHeaders: heldMail().signedHeaders, senderDomain: 'statik-weber.at' },
        strongestThread: { participantDomains: ['statik-weber.at'] },
      }),
    )
  })

  it('scores nothing for a mail dismissed whole: discarding junk is no verdict on where it would have gone', () => {
    expect(scoreMailDecision(input({ decision: null }))).toBe('not_judged')
    expect(recordDecisionScore).not.toHaveBeenCalled()
    expect(recordMailThreadMatchScore).not.toHaveBeenCalled()
  })

  it('scores a part left unfiled not at all, and the rest as decided', () => {
    const other = filePart({ id: 'p2', position: 2, suggestion: SUGGESTION, suggestionTraceId: TRACE })
    expect(scoreMailDecision(input({ parts: [textPart(), filePart({ suggestion: SUGGESTION, suggestionTraceId: TRACE }), other] }))).toBe('all')
    expect(vi.mocked(recordDecisionScore).mock.calls.map(([call]) => call.subjectId)).toEqual([FILE_PART_ID])
  })

  it('scores a text appended to a Verlauf as no verdict on its suggested folder', () => {
    const text = textPart({ suggestion: { ...SUGGESTION, documentType: null }, suggestionTraceId: TRACE })
    expect(scoreMailDecision(input({ mail: heldMail({ threadMatch: [] }), parts: [text], decision: { parts: [], message: input().decision?.message ?? null } }))).toBe(
      'not_judged',
    )
    expect(recordDecisionScore).not.toHaveBeenCalled()
  })

  it('writes no decision score for a suggestion without a trace, and answers no_suggestion without one', () => {
    expect(scoreMailDecision(input({ parts: [textPart(), filePart({ suggestion: SUGGESTION, suggestionTraceId: null })] }))).toBe('all')
    expect(recordDecisionScore).not.toHaveBeenCalled()
    expect(scoreMailDecision(input({ parts: [textPart(), filePart()] }))).toBe('no_suggestion')
  })

  it('scores a follow’s append as the follow’s, and not a text another decision already took', () => {
    scoreMailDecision(input({ via: 'follow', decision: { parts: [], message: input().decision?.message ?? null } }))
    expect(vi.mocked(recordMailThreadMatchScore).mock.calls[0][0]).toMatchObject({ via: 'follow' })
    vi.clearAllMocks()
    scoreMailDecision(input({ parts: [textPart({ state: 'filing' })] }))
    expect(recordMailThreadMatchScore).not.toHaveBeenCalled()
  })
})
