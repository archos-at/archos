import 'server-only'
import type { ZodType } from 'zod'
import { resolvePinnedRequesterSession, resolvePinnedRequesterSessionStrict } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { runBimExtractJob, runOfficeRenditionJob } from '@/lib/documents/extraction-jobs'
import { runReingestFailedSlice } from '@/lib/documents/ingest-recovery'
import { runReindexSlice } from '@/lib/documents/reindex'
import { runPurgeBinnedChunksSlice, runRestoreFolderSlice } from '@/lib/projects/folder-bin-jobs'
import { runPlacementReingestSlice } from '@/lib/projects/collection-placement'
import { runMailImportSlice } from '@/lib/mail-import/job'
import { runReportFilingJob } from '@/lib/tasks/service'
import { runAgentWake } from '@/lib/annotations/wake-job'
import { runAgentWakeStop } from '@/lib/annotations/wake-stop-job'
import { runIntakeReadSlice } from '@/lib/project-intake/service'
import { runFilingReviewSlice } from '@/lib/filing/job'
import { endRunOfDepartedRequester, runRootSortSlice } from '@/lib/filing/root-sort-run'
import { runInboxPush } from '@/lib/push/inbox-push-job'
import { runDueRemindersSlice } from '@/lib/annotations/due-reminders'
import { runDocumentCheckSlice } from '@/lib/document-check/job'
import { runRevisionNotice } from '@/lib/revision-notice/job'
import { runInboundMailFiling } from '@/lib/inbound-mail/file-job'
import { runInboundMailFollow } from '@/lib/inbound-mail/follow-job'
import { runInboundMailReceive } from '@/lib/inbound-mail/receive-job'
import { runInboundMailSenderFile } from '@/lib/inbound-mail/sender-file-job'
import { runInboundMailSuggest } from '@/lib/inbound-mail/suggest-job'
import { runSearchFacetsSyncSlice } from '@/lib/search/shelf-projection'
import { isLastAttempt } from './attempts'
import {
  annotationDueRemindersPayloadSchema,
  bimExtractPayloadSchema,
  fileResearchReportPayloadSchema,
  filingReviewPayloadSchema,
  inboxPushPayloadSchema,
  mailImportPayloadSchema,
  officeRenditionPayloadSchema,
  agentWakePayloadSchema,
  agentWakeStopPayloadSchema,
  placementReingestPayloadSchema,
  projectIntakeReadPayloadSchema,
  purgeBinnedChunksPayloadSchema,
  reindexProjectPayloadSchema,
  reingestFailedPayloadSchema,
  restoreFolderBinPayloadSchema,
  revisionNoticePayloadSchema,
  documentCheckPayloadSchema,
  inboundMailFilePayloadSchema,
  inboundMailFollowPayloadSchema,
  inboundMailSenderFilePayloadSchema,
  inboundMailReceivePayloadSchema,
  inboundMailSuggestPayloadSchema,
  rootSortPayloadSchema,
  searchFacetsSyncPayloadSchema,
  type BffJobKind,
  type JobAttempt,
  type JobRequester,
  type JobSliceResult,
} from './types'
import {
  platformTextDeindexPayloadSchema,
  platformTextIndexPayloadSchema,
  runPlatformTextDeindex,
  runPlatformTextIndex,
} from '@/lib/base-knowledge/platform/indexing'
import { officeNormsScanPayloadSchema, runNormsScanSlice } from '@/lib/base-knowledge/office/folder-norms-scan'

export type JobHandler = (job: {
  jobId?: string
  organizationId: string
  payload: unknown
  attempts: number
  signal?: AbortSignal
}) => Promise<JobSliceResult<object>>

function handler<TPayload extends { requester: JobRequester }>(
  schema: ZodType<TPayload>,
  slice: (session: AuthorizedSession, payload: TPayload) => Promise<JobSliceResult<TPayload>>
): JobHandler {
  return async ({ organizationId, payload }) => {
    const parsed = schema.parse(payload)
    const { userId, email } = parsed.requester
    const session = await resolvePinnedRequesterSession({ userId, email, organizationId })
    if (!session) {
      console.warn(`[jobs] ${userId} is no longer a member of ${organizationId}; ending a job they asked for`)
      return { done: true, payload: parsed }
    }
    return slice(session, parsed)
  }
}

function systemHandler<TPayload extends object>(
  schema: ZodType<TPayload>,
  step: (organizationId: string, payload: TPayload, attempt: JobAttempt) => Promise<void>
): JobHandler {
  return async ({ jobId, organizationId, payload, attempts }) => {
    const parsed = schema.parse(payload)
    await step(organizationId, parsed, { last: isLastAttempt(attempts), jobId })
    return { done: true, payload: parsed }
  }
}

function systemSliceHandler<TPayload extends object>(
  schema: ZodType<TPayload>,
  slice: (organizationId: string, payload: TPayload, attempt: JobAttempt) => Promise<JobSliceResult<TPayload>>
): JobHandler {
  return async ({ organizationId, payload, attempts }) =>
    slice(organizationId, schema.parse(payload), { last: isLastAttempt(attempts) })
}

const mailImportHandler: JobHandler = async ({ organizationId, payload }) => {
  const parsed = mailImportPayloadSchema.parse(payload)
  const { userId, email } = parsed.requester
  const session = await resolvePinnedRequesterSession({ userId, email, organizationId })
  return runMailImportSlice(session, parsed, organizationId)
}

const agentWakeHandler: JobHandler = async ({ organizationId, payload, attempts }) =>
  runAgentWake(organizationId, agentWakePayloadSchema.parse(payload), { last: isLastAttempt(attempts) })

const rootSortHandler: JobHandler = async ({ organizationId, payload }) => {
  const parsed = rootSortPayloadSchema.parse(payload)
  const { userId, email } = parsed.requester
  const session = await resolvePinnedRequesterSessionStrict({ userId, email, organizationId })
  if (!session) {
    await endRunOfDepartedRequester(organizationId, parsed.runId)
    return { done: true, payload: parsed }
  }
  return runRootSortSlice(session, parsed)
}

export const JOB_HANDLERS: Record<BffJobKind, JobHandler> = {
  reindex_project: handler(reindexProjectPayloadSchema, runReindexSlice),
  reingest_failed: handler(reingestFailedPayloadSchema, runReingestFailedSlice),
  placement_reingest: systemSliceHandler(placementReingestPayloadSchema, runPlacementReingestSlice),
  restore_folder_bin: handler(restoreFolderBinPayloadSchema, runRestoreFolderSlice),
  purge_binned_chunks: systemSliceHandler(purgeBinnedChunksPayloadSchema, runPurgeBinnedChunksSlice),
  bim_extract: systemHandler(bimExtractPayloadSchema, runBimExtractJob),
  office_rendition: systemHandler(officeRenditionPayloadSchema, runOfficeRenditionJob),
  file_research_report: systemHandler(fileResearchReportPayloadSchema, runReportFilingJob),
  mail_import: mailImportHandler,
  piloti_wake: agentWakeHandler,
  piloti_wake_stop: systemHandler(agentWakeStopPayloadSchema, runAgentWakeStop),
  project_intake_read: handler(projectIntakeReadPayloadSchema, runIntakeReadSlice),
  filing_review: handler(filingReviewPayloadSchema, runFilingReviewSlice),
  root_sort: rootSortHandler,
  inbox_push: systemHandler(inboxPushPayloadSchema, async (organizationId, payload, attempt) => {
    await runInboxPush(organizationId, payload, attempt)
  }),
  annotation_due_reminders: systemSliceHandler(annotationDueRemindersPayloadSchema, runDueRemindersSlice),
  revision_notice: systemHandler(revisionNoticePayloadSchema, runRevisionNotice),
  document_check: systemSliceHandler(documentCheckPayloadSchema, runDocumentCheckSlice),
  inbound_mail_receive: systemSliceHandler(inboundMailReceivePayloadSchema, runInboundMailReceive),
  inbound_mail_suggest: systemHandler(inboundMailSuggestPayloadSchema, runInboundMailSuggest),
  inbound_mail_file: handler(inboundMailFilePayloadSchema, runInboundMailFiling),
  inbound_mail_follow: systemSliceHandler(inboundMailFollowPayloadSchema, (organizationId, payload) =>
    runInboundMailFollow(organizationId, payload),
  ),
  inbound_mail_sender_file: systemSliceHandler(inboundMailSenderFilePayloadSchema, runInboundMailSenderFile),
  search_facets_sync: systemSliceHandler(searchFacetsSyncPayloadSchema, runSearchFacetsSyncSlice),
  platform_text_index: systemHandler(platformTextIndexPayloadSchema, runPlatformTextIndex),
  platform_text_deindex: systemHandler(platformTextDeindexPayloadSchema, runPlatformTextDeindex),
  office_norms_scan: systemSliceHandler(officeNormsScanPayloadSchema, (organizationId, payload) =>
    runNormsScanSlice(organizationId, payload),
  ),
}
