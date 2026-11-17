import 'server-only'
import { getLocale, getTranslations } from '@/i18n/server'
import type { Locale } from '@/i18n/config'
import type { Translator } from '@/i18n/translate'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'
import { PDF_MEDIA_TYPE, renderMarkdownPdf } from '@/lib/pdf/markdown-pdf'
import type { DocumentFact } from '@/lib/answer-export/answer-document'
import { AI_GENERATOR_NAME } from '@/lib/ai-provenance'
import { buildProjectBriefView } from '@/lib/project-profile/brief-view'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { findProjectInOrg } from '@/lib/projects/repository'
import { ApiError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY, type FileResearchReportPayload } from '@/lib/jobs-queue/types'
import { resolveDocumentBranding } from './branding'
import { contentDigest } from './content-digest'
import { assertMayFileGeneratedDocument, fileGeneratedDocument, type FiledGeneratedDocument } from './generated'
import { createDocumentVersion, transitionDocumentVersion } from './lifecycle'
import { findDocumentAuthoredByRef, findDocumentInOrg } from './repository'
import { internalRead } from '@/lib/documents/document-reader'
import { findOpenVersion } from './version-repository'

export interface FileResearchReportInput {
  session: AuthorizedSession
  projectId: string
  runId: string
  report: string
  cards?: unknown[]
  request?: Request
}

export function splitReportTitle(report: string): { title: string | null; body: string } {
  const match = /^[\s]*#\s+(.+?)\s*(?:\n|$)/.exec(report)
  if (!match) return { title: null, body: report }
  return { title: match[1].trim(), body: report.slice(match[0].length) }
}

const COVER_FACT_PLACEHOLDER = '—'

function briefFact(
  facts: ReadonlyMap<string, string>,
  key: string
): string | undefined {
  const value = facts.get(key)?.trim()
  if (!value || value === COVER_FACT_PLACEHOLDER) return undefined
  return value
}

function coverRows(
  projectName: string | undefined,
  profile: unknown,
  createdAt: Date,
  runId: string,
  t: Translator,
  locale: Locale
): DocumentFact[] {
  const rows: DocumentFact[] = []
  if (projectName?.trim()) rows.push({ label: t('project'), value: projectName.trim() })

  const brief = buildProjectBriefView(profile ?? {})
  const facts = new Map(
    brief.groups.flatMap((group) => group.facts.map((fact) => [fact.key, fact.value] as const))
  )

  const location = briefFact(facts, 'site_address')
  if (location) rows.push({ label: t('reportCover.location'), value: location })

  const federalState = briefFact(facts, 'federal_state')
  if (federalState) rows.push({ label: t('reportCover.bundesland'), value: federalState })

  const buildingClass = briefFact(facts, 'building_class')
  if (buildingClass) rows.push({ label: t('fields.gebaeudeklasse'), value: buildingClass })

  rows.push({
    label: t('createdAt'),
    value: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(createdAt),
  })
  rows.push({ label: t('reportCover.author'), value: AI_GENERATOR_NAME })
  rows.push({ label: t('reportCover.analysisId'), value: runId, mono: true })

  return rows
}

async function loadProfile(projectId: string, organizationId: string): Promise<unknown> {
  try {
    const project = await findProjectInOrg(projectId, organizationId)
    return project?.profile ?? null
  } catch (error) {
    console.error('[documents] could not read the project profile for a report cover', {
      projectId,
      cause: error instanceof Error ? error.name : 'unknown',
    })
    return null
  }
}

export async function fileResearchReport(
  input: FileResearchReportInput,
): Promise<FiledGeneratedDocument> {
  const filed = await renderAndFileReport(input)
  await openReviewRound(input, filed)
  return filed
}

async function openReviewRound(
  input: FileResearchReportInput,
  filed: FiledGeneratedDocument,
): Promise<void> {
  const { session, request } = input
  try {
    const existing = await findOpenVersion(filed.documentId, session.organizationId)
    if (existing) return

    const document = await findDocumentInOrg(filed.documentId, session.organizationId, internalRead('just-written'))
    if (!document) return

    const version = await createDocumentVersion(session, {
      document,
      op: 'create',
      storageKey: document.storageKey,
      storageBucket: document.storageBucket,
      contentType: document.contentType,
      fileSize: document.fileSize,
      contentHash: document.contentHash ?? contentDigest(new TextEncoder().encode(input.report)),
      request,
    })

    await transitionDocumentVersion(session, filed.documentId, version.id, 'submit', {
      reviewerUserIds: [session.userId],
      request,
      actingHuman: false,
    })
  } catch (error) {
    console.error('[documents] a filed report could not open its review round', {
      documentId: filed.documentId,
      cause: error instanceof Error ? error.name : 'unknown',
    })
  }
}

async function renderAndFileReport(
  input: FileResearchReportInput,
): Promise<FiledGeneratedDocument> {
  const { session, projectId, runId, report, cards, request } = input
  const { title, body } = splitReportTitle(report)
  const [t, locale, organizationName] = await Promise.all([
    getTranslations(answerExportCopy),
    getLocale(),
    getOrganizationDisplayName(session.organizationId),
  ])
  const documentTitle = title ?? t('documentTitle')
  const branding = await resolveDocumentBranding({
    organizationId: session.organizationId,
    organizationName,
    locale,
  })

  return fileGeneratedDocument({
    session,
    projectId,
    producer: 'deep_research',
    ref: runId,
    title: documentTitle,
    request,
    render: async ({ projectName, marking }) => {
      const profile = await loadProfile(projectId, session.organizationId)
      const bytes = await renderMarkdownPdf(body, {
        title: documentTitle,
        diagramPlaceholder: t('diagramPlaceholder'),
        facts: coverRows(
          projectName,
          profile,
          new Date(),
          runId,
          t,
          locale
        ),
        cards,
        locale,
        marking,
        branding,
      })
      return { bytes, contentType: PDF_MEDIA_TYPE, marking }
    },
  })
}

export async function findFiledResearchReport(input: {
  organizationId: string
  projectId: string
  runId: string
}): Promise<FiledGeneratedDocument | null> {
  const existing = await findDocumentAuthoredByRef(
    input.runId,
    input.organizationId,
    input.projectId,
    'deep_research'
  )
  if (!existing) return null
  return { documentId: existing.id, filename: existing.filename, folderId: existing.folderId, alreadyFiled: true }
}

export async function findReportFilingRefusal(
  session: AuthorizedSession,
  projectId: string,
): Promise<string | null> {
  try {
    await assertMayFileGeneratedDocument(session, projectId)
    return null
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return `${error.name}: ${error.message}`.slice(0, 500)
    }
    throw error
  }
}

export async function queueResearchReportFiling(input: {
  organizationId: string
  payload: FileResearchReportPayload
}): Promise<{ jobId: string }> {
  const open = await findOpenJobId({
    kind: 'file_research_report',
    organizationId: input.organizationId,
    matching: { runId: input.payload.runId },
  })
  if (open) return { jobId: open }
  return enqueueJob({
    kind: 'file_research_report',
    organizationId: input.organizationId,
    priority: BFF_JOB_PRIORITY.interactive,
    payload: input.payload,
  })
}
