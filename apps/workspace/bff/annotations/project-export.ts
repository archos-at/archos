import 'server-only'
import { UnprocessableError } from '@/lib/api/errors'
import type { DocBlock } from '@/lib/answer-export/blocks'
import { paragraph } from '@/lib/answer-export/blocks'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findProjectInOrg } from '@/lib/projects/repository'
import { getLocale, getTranslations } from '@/i18n/server'
import type { Translator } from '@/i18n/translate'
import { filesCopy } from '@/i18n/namespaces/files'
import type { CoverFact } from '@/lib/pdf/branding'
import { protocolFileNameOf } from './export-request'
import {
  entryBlocks,
  formatters,
  holdsAgentText,
  renderProtocol,
  selectMarks,
  type ExportedProtocol,
  type Protocol,
  type ProtocolSelection,
} from './export'
import { listProjectAnnotations } from './project-marks'
import {
  ASSIGNEE_ME,
  MAX_PROJECT_MARKS_PAGE,
  PROJECT_PROTOCOL_MAX_MARKS,
  type ProjectMarkView,
  type ProjectProtocolQuery,
} from './project-types'

export interface ProjectProtocolGroup {
  documentName: string
  selection: ProtocolSelection
}

export interface ProjectProtocolHeader {
  projectName: string
  selection: string
  exportedAt: Date
  exportedBy: string
}

export function groupByDocument(marks: readonly ProjectMarkView[]): ProjectProtocolGroup[] {
  const groups = new Map<string, { documentName: string; marks: ProjectMarkView[] }>()
  for (const mark of marks) {
    const group = groups.get(mark.documentId) ?? { documentName: mark.documentName, marks: [] }
    group.marks.push(mark)
    groups.set(mark.documentId, group)
  }
  return [...groups.values()].map(({ documentName, marks: documentMarks }) => ({
    documentName,
    selection: selectMarks(documentMarks, { scope: 'open', revision: 'current', includeProposals: true }),
  }))
}

export function buildProjectProtocol(
  header: ProjectProtocolHeader,
  groups: readonly ProjectProtocolGroup[],
  t: Translator,
  locale: string
): Protocol {
  const f = formatters(locale, header.exportedAt)
  const documentBlocks = (group: ProjectProtocolGroup): DocBlock[] => [
    { kind: 'heading', level: 2, text: group.documentName },
    ...group.selection.marks.flatMap((annotation) => entryBlocks(annotation, t, f)),
    ...(group.selection.proposals.length > 0
      ? [
          { kind: 'heading' as const, level: 3 as const, text: t('review.export.document.proposals') },
          paragraph(t('review.export.document.proposalsNote'), 'meta'),
          ...group.selection.proposals.flatMap((annotation) => entryBlocks(annotation, t, f)),
        ]
      : []),
  ]
  const facts: CoverFact[] = [
    { label: t('review.export.document.project'), value: header.projectName },
    { label: t('review.export.document.scope'), value: header.selection },
    { label: t('openPoints.export.documents'), value: String(groups.length) },
    { label: t('review.export.document.exportedAt'), value: f.dateTime(header.exportedAt) },
    { label: t('review.export.document.exportedBy'), value: header.exportedBy },
  ]
  return {
    title: t('openPoints.export.title', { name: header.projectName }),
    facts,
    body: groups.length > 0 ? groups.flatMap(documentBlocks) : [paragraph(t('review.export.document.none'))],
    aiProvenance: groups.some((group) => holdsAgentText(group.selection)) ? { composite: true } : null,
  }
}

export function selectionLine(
  query: Pick<ProjectProtocolQuery, 'status' | 'assignee' | 'due'>,
  assigneeName: string | null,
  t: Translator
): string {
  return [
    t(`openPoints.export.status.${query.status}`),
    ...(query.assignee ? [t('openPoints.export.assignee', { name: assigneeName ?? t('review.someone') })] : []),
    ...(query.due ? [t(`openPoints.export.due.${query.due}`)] : []),
  ].join(' · ')
}

async function gatherMarks(
  session: AuthorizedSession,
  projectId: string,
  query: ProjectProtocolQuery,
  now: Date
): Promise<ProjectMarkView[]> {
  const marks: ProjectMarkView[] = []
  let cursor: string | undefined
  do {
    const page = await listProjectAnnotations(
      session,
      projectId,
      { ...query, order: 'document', limit: MAX_PROJECT_MARKS_PAGE, cursor },
      now
    )
    marks.push(...page.marks)
    if (marks.length > PROJECT_PROTOCOL_MAX_MARKS) {
      throw new UnprocessableError(
        `A project Protokoll carries at most ${PROJECT_PROTOCOL_MAX_MARKS} Anmerkungen; narrow it with a filter.`,
        { reason: 'too-many-marks' }
      )
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return marks
}

export async function exportProjectProtocol(
  session: AuthorizedSession,
  projectId: string,
  query: ProjectProtocolQuery,
  request?: Request
): Promise<ExportedProtocol> {
  const now = new Date()
  const marks = await gatherMarks(session, projectId, query, now)
  const [project, locale, t] = await Promise.all([
    findProjectInOrg(projectId, session.organizationId),
    getLocale(),
    getTranslations(filesCopy),
  ])
  const projectName = project?.name ?? ''
  const exportedBy = session.name ?? session.email
  const assigneeName =
    query.assignee === ASSIGNEE_ME ? exportedBy : (marks.find((mark) => mark.assigneeName)?.assigneeName ?? null)
  const groups = groupByDocument(marks)
  const protocol = buildProjectProtocol(
    { projectName, selection: selectionLine(query, assigneeName, t), exportedAt: now, exportedBy },
    groups,
    t,
    locale
  )
  const file = await renderProtocol(protocol, query.format)

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.annotations.exported',
    targetType: 'project',
    targetId: projectId,
    metadata: {
      format: query.format,
      status: query.status,
      assignee: query.assignee === ASSIGNEE_ME ? 'me' : query.assignee ? 'person' : 'any',
      due: query.due ?? 'any',
      documentCount: groups.length,
      markCount: groups.reduce((sum, group) => sum + group.selection.marks.length, 0),
      proposalCount: groups.reduce((sum, group) => sum + group.selection.proposals.length, 0),
    },
    request,
  })

  return { filename: protocolFileNameOf(t('openPoints.export.fileName', { name: projectName }), query.format), ...file }
}
