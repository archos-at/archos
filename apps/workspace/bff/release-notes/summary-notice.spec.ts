/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./seen-repository', () => ({
  findReleaseNoticeRecord: vi.fn(),
  recordReleaseWeekSeen: vi.fn(),
  setReleaseNoticeEnabled: vi.fn(),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { NO_TOURS } from '@/lib/onboarding/product-tour'
import type { ReleaseNoteArtifact } from './release-notes'
import { RELEASE_NOTE_AREAS, RELEASE_NOTE_SECTIONS } from './release-notes-wire'
import { findReleaseNoticeRecord, recordReleaseWeekSeen, setReleaseNoticeEnabled } from './seen-repository'
import {
  getUnseenReleaseSummary,
  latestReleaseSummary,
  markReleaseSummarySeen,
  resolveWhatsNewNotice,
  setReleaseNoticePreference,
  unseenSummary,
} from './summary-notice'

const SESSION = { userId: 'user-1', organizationId: 'org-1' } as AuthorizedSession

const week = (id: string, summary: string | null) => ({
  id,
  kind: 'week' as const,
  version: null,
  date: '2026-10-26',
  dateEnd: '2026-11-01',
  summary: summary ? { en: summary, de: `${summary} (de)` } : null,
  notes: [],
})

const SOURCE: ReleaseNoteArtifact = {
  sections: RELEASE_NOTE_SECTIONS,
  areas: RELEASE_NOTE_AREAS,
  // The current week has no summary yet; the latest summary is W44's.
  releases: [week('2026-W45', null), week('2026-W44', 'The week.'), week('2026-W43', 'The week before.')],
}

const ON = { lastSeenWeek: null, enabled: true }

describe('the weekly summary notice (ADR-0154, amendment)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('takes the newest week that has a summary, and nothing when none has', () => {
    expect(latestReleaseSummary(SOURCE)?.id).toBe('2026-W44')
    expect(latestReleaseSummary({ ...SOURCE, releases: [week('2026-W45', null)] })).toBeNull()
  })

  it('shows the latest summary once: never after it, or a later week, was seen', () => {
    const latest = latestReleaseSummary(SOURCE)
    expect(unseenSummary(latest, ON)?.id).toBe('2026-W44')
    expect(unseenSummary(latest, { ...ON, lastSeenWeek: '2026-W43' })?.id).toBe('2026-W44')
    expect(unseenSummary(latest, { ...ON, lastSeenWeek: '2026-W44' })).toBeNull()
    expect(unseenSummary(latest, { ...ON, lastSeenWeek: '2026-W45' })).toBeNull()
  })

  it('never shows it to someone who turned it off', () => {
    const latest = latestReleaseSummary(SOURCE)
    expect(unseenSummary(latest, { lastSeenWeek: null, enabled: false })).toBeNull()
    expect(unseenSummary(latest, { lastSeenWeek: '2026-W30', enabled: false })).toBeNull()
  })

  it('is recorded quietly for someone new here, whom a product tour is about to greet', async () => {
    vi.mocked(findReleaseNoticeRecord).mockResolvedValue(ON)
    const returning = await resolveWhatsNewNotice(SESSION, NO_TOURS)
    const fresh = await resolveWhatsNewNotice(SESSION, { welcome: true, project: true })
    expect(returning?.quietly).toBe(false)
    expect(fresh?.quietly).toBe(true)
  })

  it('a failed read means no notice, never a broken frame', async () => {
    vi.mocked(findReleaseNoticeRecord).mockRejectedValue(new Error('db down'))
    expect(await resolveWhatsNewNotice(SESSION, NO_TOURS)).toBeNull()
  })

  it('records only a week that has a published summary, and "stop" turns the notice off', async () => {
    vi.mocked(recordReleaseWeekSeen).mockResolvedValue({ lastSeenWeek: '2026-W44', enabled: false })
    await expect(markReleaseSummarySeen(SESSION, '2026-W45', {}, SOURCE)).rejects.toThrow(/No weekly summary/)
    await markReleaseSummarySeen(SESSION, '2026-W44', { stop: true }, SOURCE)
    expect(recordReleaseWeekSeen).toHaveBeenCalledWith('user-1', 'org-1', '2026-W44', false)
  })

  it('turned back on, resumes with the next week published, not the one it was turned off in', async () => {
    vi.mocked(recordReleaseWeekSeen).mockResolvedValue({ lastSeenWeek: '2026-W44', enabled: true })
    vi.mocked(setReleaseNoticeEnabled).mockResolvedValue({ lastSeenWeek: '2026-W40', enabled: false })
    expect(await setReleaseNoticePreference(SESSION, true)).toEqual({ enabled: true })
    // Re-enabling records the newest summary as seen in the same write.
    expect(recordReleaseWeekSeen).toHaveBeenCalledWith('user-1', 'org-1', latestReleaseSummary()?.id, true)
    expect(await setReleaseNoticePreference(SESSION, false)).toEqual({ enabled: false })
    expect(setReleaseNoticeEnabled).toHaveBeenCalledWith('user-1', 'org-1', false)
  })

  it('after turning it back on, the next week shows: the latest only, never a backlog', async () => {
    // Off since W40, back on in W44 (which recorded W44): W45 and W46 are published since.
    const later: ReleaseNoteArtifact = {
      ...SOURCE,
      releases: [week('2026-W46', 'Two weeks on.'), week('2026-W45', 'A week on.'), ...SOURCE.releases.slice(1)],
    }
    expect(unseenSummary(latestReleaseSummary(later), { lastSeenWeek: '2026-W44', enabled: true })?.id).toBe('2026-W46')
  })

  it('reads the record of the person in the session', async () => {
    vi.mocked(findReleaseNoticeRecord).mockResolvedValue({ lastSeenWeek: null, enabled: true })
    await getUnseenReleaseSummary(SESSION)
    expect(findReleaseNoticeRecord).toHaveBeenCalledWith('user-1', 'org-1')
  })
})
