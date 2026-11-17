import 'server-only'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { requesterOf } from '@/lib/jobs-queue/types'
import { findProjectIdByCollectionName } from '@/lib/projects/repository'
import { findFiledResearchReport, findReportFilingRefusal, queueResearchReportFiling } from './research-report'

interface ReportFilingResult {
  documentId: string
  filename: string
  alreadyFiled: boolean
}

export type ReportFilingOutcome =
  | { outcome: 'filed'; filed: ReportFilingResult }
  | { outcome: 'queued' }
  | { outcome: 'refused' }
  | { outcome: 'failed' }

function readReportMarkdown(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const body = data as { has_report?: unknown; report?: unknown }
  if (body.has_report !== true) return null
  return typeof body.report === 'string' && body.report.trim() ? body.report : null
}

function readCommissioningCollection(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const body = data as { project_collection?: unknown }
  return typeof body.project_collection === 'string' && body.project_collection
    ? body.project_collection
    : null
}

function readReportCards(data: unknown): unknown[] | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { cards } = data as { cards?: unknown }
  return Array.isArray(cards) && cards.length > 0 ? cards : undefined
}

export async function fileCommissionedReport({
  runId,
  session,
  body,
}: {
  runId: string
  session: UserSession | null
  body: unknown
}): Promise<ReportFilingOutcome | null> {
  if (!session?.organizationId) return null

  const report = readReportMarkdown(body)
  if (!report) return null

  const commissioned = readCommissioningCollection(body)
  if (!commissioned) return null
  const commissionedProjectId = await findProjectIdByCollectionName(commissioned, session.organizationId)
  if (!commissionedProjectId) return null

  try {
    const filed = await findFiledResearchReport({
      organizationId: session.organizationId,
      projectId: commissionedProjectId,
      runId,
    })
    if (filed) {
      return {
        outcome: 'filed',
        filed: { documentId: filed.documentId, filename: filed.filename, alreadyFiled: true },
      }
    }

    const refusal = await findReportFilingRefusal(session as AuthorizedSession, commissionedProjectId)
    if (refusal) {
      console.warn(`[Deep Research API] the reader may not file the report of run ${runId}: ${refusal}`)
      return { outcome: 'refused' }
    }

    await queueResearchReportFiling({
      organizationId: session.organizationId,
      payload: {
        runId,
        projectId: commissionedProjectId,
        report,
        cards: readReportCards(body),
        taskRunId: null,
        requester: requesterOf(session as AuthorizedSession),
      },
    })
    return { outcome: 'queued' }
  } catch (error) {
    console.error(`[Deep Research API] failed to queue the report's filing:`, error)
    return { outcome: 'failed' }
  }
}
