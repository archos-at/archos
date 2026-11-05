/**
 * The "Neu diese Woche" notice (ADR-0156, amendment): the newest weekly summary, shown to a
 * signed-in person once, until a newer week's summary is published.
 *
 * Only a week with a summary counts, and only the newest one: a person back from three weeks
 * away is shown the latest summary, and the "Neuerungen" page holds the rest. The record of what
 * a person has seen is server-side and per person (`seen-repository.ts`), so a second device does
 * not show it again.
 */

import 'server-only'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { TourEligibility } from '@/lib/onboarding/product-tour'
import { releaseNoteArtifact, type ReleaseNoteArtifact } from './release-notes'
import type { ReleaseSummary, WhatsNewNoticeState } from './release-notes-wire'
import {
  findReleaseNoticeRecord,
  recordReleaseWeekSeen,
  setReleaseNoticeEnabled,
  type ReleaseNoticeRecord,
} from './seen-repository'

/** The newest week that has a summary, or null. Versions (once releases are tagged) do not count. */
export function latestReleaseSummary(source: ReleaseNoteArtifact = releaseNoteArtifact()): ReleaseSummary | null {
  const week = source.releases.find(
    (release) => release.kind === 'week' && release.summary && release.date && release.dateEnd,
  )
  if (!week?.summary || !week.date || !week.dateEnd) return null
  return { id: week.id, date: week.date, dateEnd: week.dateEnd, summary: week.summary }
}

/**
 * The latest summary when the person wants the notice and has not seen it (or a later one), else
 * null. Pure. Only ever the latest: a person back after weeks away gets one notice, not a backlog.
 */
export function unseenSummary(latest: ReleaseSummary | null, record: ReleaseNoticeRecord): ReleaseSummary | null {
  if (!latest || !record.enabled) return null
  return record.lastSeenWeek !== null && record.lastSeenWeek >= latest.id ? null : latest
}

/** The latest summary this person has not seen yet and would be shown, or null. */
export async function getUnseenReleaseSummary(session: AuthorizedSession): Promise<ReleaseSummary | null> {
  const latest = latestReleaseSummary()
  if (!latest) return null
  return unseenSummary(latest, await findReleaseNoticeRecord(session.userId, session.organizationId))
}

/**
 * Record a week's summary as seen; with `stop`, also turn the notice off for good ("Nicht mehr
 * anzeigen"). Only a week that has a summary may be recorded, so a mistyped or future week cannot
 * silence the next real one. The week stored never moves back.
 */
export async function markReleaseSummarySeen(
  session: AuthorizedSession,
  week: string,
  options: { stop?: boolean } = {},
  source: ReleaseNoteArtifact = releaseNoteArtifact(),
): Promise<ReleaseNoticeRecord> {
  const known = source.releases.some((release) => release.kind === 'week' && release.id === week && release.summary)
  if (!known) throw new BadRequestError(`No weekly summary is published for ${week}.`)
  return recordReleaseWeekSeen(session.userId, session.organizationId, week, options.stop ? false : undefined)
}

/** Whether the person wants the weekly notice, for the switch on their profile page. */
export async function getReleaseNoticePreference(session: AuthorizedSession): Promise<{ enabled: boolean }> {
  const record = await findReleaseNoticeRecord(session.userId, session.organizationId)
  return { enabled: record.enabled }
}

/**
 * Turn the weekly notice on or off. Turning it back on records the newest summary as seen, so
 * the notice resumes with the next week published rather than greeting the person with the one
 * from the week they turned it off in.
 */
export async function setReleaseNoticePreference(
  session: AuthorizedSession,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const latest = enabled ? latestReleaseSummary() : null
  const record = latest
    ? await recordReleaseWeekSeen(session.userId, session.organizationId, latest.id, true)
    : await setReleaseNoticeEnabled(session.userId, session.organizationId, enabled)
  return { enabled: record.enabled }
}

/**
 * What the app frame does about the notice on this load. Someone new here, for whom a product
 * tour starts by itself (`tourEligibility`: nothing written in the organization, the tour not
 * seen), is not shown it: a summary of what changed means nothing before they have seen the
 * product, and it would stand on the tour. The week is recorded for them quietly instead, so the
 * next week's summary is their first.
 *
 * Tolerant like the rest of the frame: a failure means no notice, never a broken page.
 */
export async function resolveWhatsNewNotice(
  session: AuthorizedSession,
  tours: TourEligibility,
): Promise<WhatsNewNoticeState | null> {
  try {
    const summary = await getUnseenReleaseSummary(session)
    if (!summary) return null
    return { summary, quietly: tours.welcome || tours.project }
  } catch {
    return null
  }
}
