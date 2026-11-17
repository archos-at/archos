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

export function latestReleaseSummary(source: ReleaseNoteArtifact = releaseNoteArtifact()): ReleaseSummary | null {
  const week = source.releases.find(
    (release) => release.kind === 'week' && release.summary && release.date && release.dateEnd,
  )
  if (!week?.summary || !week.date || !week.dateEnd) return null
  return { id: week.id, date: week.date, dateEnd: week.dateEnd, summary: week.summary }
}

export function unseenSummary(latest: ReleaseSummary | null, record: ReleaseNoticeRecord): ReleaseSummary | null {
  if (!latest || !record.enabled) return null
  return record.lastSeenWeek !== null && record.lastSeenWeek >= latest.id ? null : latest
}

export async function getUnseenReleaseSummary(session: AuthorizedSession): Promise<ReleaseSummary | null> {
  const latest = latestReleaseSummary()
  if (!latest) return null
  return unseenSummary(latest, await findReleaseNoticeRecord(session.userId, session.organizationId))
}

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

export async function getReleaseNoticePreference(session: AuthorizedSession): Promise<{ enabled: boolean }> {
  const record = await findReleaseNoticeRecord(session.userId, session.organizationId)
  return { enabled: record.enabled }
}

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
