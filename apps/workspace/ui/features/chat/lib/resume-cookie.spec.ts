/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import {
  arrivalResumes,
  chatResumeCookie,
  resumeCookieNames,
  resumeCookieWrites,
  resumeDeadlines,
} from './resume-cookie'
import { RESUME_WINDOW_MS, openOnSide, resumableSessionId, resumesUntil, type ArrivalState } from './resume-session'
import { conversationsOnSide } from './project-scope'

const NOW = new Date('2026-11-25T09:00:00Z').getTime()
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000)

const conversation = (id: string, over: Partial<ArrivalState['conversations'][number]> = {}) => ({
  id,
  userId: 'anna',
  projectId: null,
  updatedAt: hoursAgo(1),
  messages: [{}],
  ...over,
})

const state = (over: Partial<ArrivalState> = {}): ArrivalState => ({
  currentUserId: 'anna',
  currentConversation: null,
  conversations: [],
  ...over,
})

const arrivalOpens = (s: ArrivalState, side: string | null): boolean =>
  (openOnSide(s, side) ?? resumableSessionId(conversationsOnSide(s.conversations, s.currentUserId, side), NOW)) !== null

describe('the server learns whether a side resumes a chat', () => {
  test('a side with a chat touched within the window resumes it until the window closes', () => {
    const s = state({ conversations: [conversation('c1', { updatedAt: hoursAgo(2) })] })
    expect(resumesUntil(s, null, NOW)).toBe(hoursAgo(2).getTime() + RESUME_WINDOW_MS)
  })

  test('a chat open on the side resumes however old it is', () => {
    const old = conversation('c1', { projectId: 'p1', updatedAt: hoursAgo(40) })
    const s = state({ conversations: [old], currentConversation: old })
    expect(resumesUntil(s, 'p1', NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(resumesUntil(s, null, NOW)).toBeNull()
  })

  test('a side whose newest chat is empty, stale or someone else’s resumes nothing', () => {
    expect(resumesUntil(state({ conversations: [conversation('c1', { messages: [] })] }), null, NOW)).toBeNull()
    expect(resumesUntil(state({ conversations: [conversation('c1', { updatedAt: hoursAgo(13) })] }), null, NOW)).toBeNull()
    expect(resumesUntil(state({ conversations: [conversation('c1', { userId: 'bert' })] }), null, NOW)).toBeNull()
  })

  test('agrees with the decision the chat takes on arrival, for every side', () => {
    const open = conversation('open', { projectId: 'p2', updatedAt: hoursAgo(30) })
    const s = state({
      currentConversation: open,
      conversations: [
        open,
        conversation('fresh', { projectId: 'p1', updatedAt: hoursAgo(3) }),
        conversation('stale', { projectId: 'p3', updatedAt: hoursAgo(20) }),
        conversation('empty', { projectId: 'p4', messages: [] }),
        conversation('job', { projectId: 'p5', jobId: 'j1' }),
        conversation('personal', { updatedAt: hoursAgo(11.9) }),
      ],
    })
    const deadlines = resumeDeadlines(s, NOW)
    for (const side of [null, 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
      expect([side, deadlines.has(chatResumeCookie(side)!)]).toEqual([side, arrivalOpens(s, side)])
    }
  })

  test('the cookie lives exactly as long as the resume, and leaves when the side stops resuming', () => {
    const wanted = new Map([
      ['chat_resume.personal', NOW + 90_500],
      ['chat_resume.p1', Number.POSITIVE_INFINITY],
    ])
    expect(resumeCookieWrites(new Map([['chat_resume.p9', Number.NaN]]), wanted, NOW)).toEqual([
      'chat_resume.personal=1; path=/app; max-age=91; samesite=lax',
      'chat_resume.p1=1; path=/app; max-age=31536000; samesite=lax',
      'chat_resume.p9=; path=/app; max-age=0; samesite=lax',
    ])
    expect(resumeCookieWrites(wanted, wanted, NOW)).toEqual([])
  })

  test('the cookie names a side and holds nothing else', () => {
    expect(chatResumeCookie(null)).toBe('chat_resume.personal')
    expect(chatResumeCookie('039838f0-f36e-4e01-bc78-de4309fea7b9')).toBe('chat_resume.039838f0-f36e-4e01-bc78-de4309fea7b9')
    expect(chatResumeCookie('a;b=c')).toBeNull()
    expect(resumeCookieNames('locale=de; chat_resume.personal=1; last_place=%2Fapp')).toEqual(['chat_resume.personal'])
  })

  test('a link to a chat shows its skeleton, a new chat never does, otherwise the cookie decides', () => {
    expect(arrivalResumes({ session: 'c1' }, false)).toBe(true)
    expect(arrivalResumes({ new: '1' }, true)).toBe(false)
    expect(arrivalResumes({}, true)).toBe(true)
    expect(arrivalResumes({}, false)).toBe(false)
  })
})
