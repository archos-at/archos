import 'server-only'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { UnprocessableError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { documentDisplayName, splitDocumentName } from '@/lib/documents/display-name'
import { calendarDayIn, OFFICE_TIME_ZONE } from '@/lib/format'
import { listDocumentVersions } from '@/lib/documents/version-repository'
import { findProjectInOrg } from '@/lib/projects/repository'
import { escapeInline, escapeLineStarts, escapeMarkdown } from '@/lib/text/markdown-escape'
import { BlocksDocument } from '@/lib/pdf/blocks-to-pdf'
import type { CoverFact } from '@/lib/pdf/branding'
import { MAX_MARKDOWN_PDF_CHARS, PDF_MEDIA_TYPE, TABLE_CELL_COST_CHARS } from '@/lib/pdf/markdown-pdf'
import { DOCX_MEDIA_TYPE, renderDocx } from '@/lib/answer-export/docx'
import { aiProvenanceMarking, type AiProvenance } from '@/lib/ai-provenance'
import { withAiProvenanceXmp } from '@/lib/pdf/xmp-metadata'
import { labelled, paragraph, type DocBlock, type DocRun } from '@/lib/answer-export/blocks'
import { getLocale, getTranslations } from '@/i18n/server'
import type { Translator } from '@/i18n/translate'
import { filesCopy } from '@/i18n/namespaces/files'
import { listAnnotations } from './service'
import { isLive, isOverdue, type AnnotationView } from './types'
import { protocolFileNameOf, type AnnotationExportOptions } from './export-request'
import { PRODUCT_NAME } from '@/lib/brand'

export const MARKDOWN_MEDIA_TYPE = 'text/markdown; charset=utf-8'

export interface ExportedProtocol {
  filename: string
  bytes: Uint8Array
  mediaType: string
}

export interface ProtocolRevision {
  number: number
  total: number
  createdAt: string
}

export interface ProtocolHeader {
  documentName: string
  revision: ProtocolRevision | null
  projectName: string | null
  exportedAt: Date
  exportedBy: string
}

export interface ProtocolSelection {
  marks: AnnotationView[]
  proposals: AnnotationView[]
}

export interface Protocol {
  title: string
  facts: CoverFact[]
  body: DocBlock[]
  aiProvenance: AiProvenance | null
}

export function holdsAgentText(selection: ProtocolSelection): boolean {
  return [...selection.marks, ...selection.proposals].some(
    (annotation) =>
      annotation.authorKind !== 'person' || annotation.replies.some((reply) => reply.authorKind !== 'person')
  )
}

const unreviewed = (annotation: AnnotationView): boolean =>
  annotation.authorKind === 'piloti' && annotation.acceptedBy === null

const byNumber = (a: AnnotationView, b: AnnotationView): number => a.number - b.number

export function selectMarks(
  annotations: readonly AnnotationView[],
  options: Pick<AnnotationExportOptions, 'scope' | 'revision' | 'includeProposals'>
): ProtocolSelection {
  const wanted = annotations.filter(
    (annotation) =>
      (options.revision === 'all' || annotation.onCurrentRevision || isLive(annotation)) &&
      (options.scope === 'all' || isLive(annotation))
  )
  return {
    marks: wanted.filter((annotation) => !unreviewed(annotation)).sort(byNumber),
    proposals: options.includeProposals ? wanted.filter(unreviewed).sort(byNumber) : [],
  }
}

export interface Formatters {
  day: (isoDay: string) => string
  date: (iso: string) => string
  dateTime: (value: Date) => string
  today: string
}

export function formatters(locale: string, now: Date): Formatters {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: OFFICE_TIME_ZONE })
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: OFFICE_TIME_ZONE,
  })
  return {
    day: (isoDay) => day.format(new Date(`${isoDay}T00:00:00Z`)),
    date: (iso) => date.format(new Date(iso)),
    dateTime: (value) => dateTime.format(value),
    today: calendarDayIn(OFFICE_TIME_ZONE, now),
  }
}

const agentFor = (t: Translator, name: string | null): string =>
  name ? t('review.attribution.agentFor', { name }) : PRODUCT_NAME

function attributionLines(annotation: AnnotationView, t: Translator, f: Formatters): string[] {
  const set = f.date(annotation.createdAt)
  const lines: string[] = []
  if (unreviewed(annotation)) {
    lines.push(
      annotation.createdByName
        ? t('review.export.document.proposalFor', { name: annotation.createdByName, date: set })
        : t('review.export.document.proposal', { date: set })
    )
  } else if (annotation.authorKind === 'piloti') {
    lines.push(
      annotation.acceptedByName
        ? t('review.export.document.agentSetFor', { name: annotation.acceptedByName, date: set })
        : t('review.export.document.agentSet', { date: set })
    )
  } else {
    lines.push(
      t('review.export.document.setBy', { name: annotation.createdByName ?? t('review.someone'), date: set })
    )
  }
  if (annotation.status === 'resolved' || annotation.status === 'dismissed') {
    const key = annotation.status === 'resolved' ? 'closedResolved' : 'closedDismissed'
    lines.push(
      t(`review.export.document.${key}`, {
        name: annotation.closedByName ?? t('review.someone'),
        date: annotation.closedAt ? f.date(annotation.closedAt) : '',
      })
    )
  }
  if (annotation.delegatedBy) lines.push(t('review.export.document.delegated', { name: annotation.delegatedByName ?? t('review.someone') }))
  return lines
}

function factLines(annotation: AnnotationView, t: Translator, f: Formatters): DocBlock[] {
  const blocks: DocBlock[] = []
  if (annotation.basis) blocks.push(labelled(t('review.export.document.basis'), annotation.basis))
  if (annotation.assigneeName) blocks.push(labelled(t('review.export.document.assignee'), annotation.assigneeName))
  if (annotation.dueOn) {
    const due = f.day(annotation.dueOn)
    const overdue = isOverdue(annotation, f.today) ? ` · ${t('review.overdue')}` : ''
    blocks.push(labelled(t('review.export.document.due'), `${due}${overdue}`))
  }
  if (!annotation.onCurrentRevision) {
    blocks.push(
      paragraph(
        annotation.revisionNumber === null
          ? t('annotations.earlierRevisionUnnumbered')
          : t('annotations.earlierRevision', { number: annotation.revisionNumber }),
        'meta'
      )
    )
  }
  return blocks
}

function threadBlocks(annotation: AnnotationView, t: Translator, f: Formatters): DocBlock[] {
  if (annotation.replies.length === 0) return []
  const items: DocRun[][] = annotation.replies.map((reply) => {
    const author =
      reply.authorKind === 'piloti' ? agentFor(t, reply.createdByName) : (reply.createdByName ?? t('review.someone'))
    return [{ text: `${author} · ${f.date(reply.createdAt)}: `, bold: true }, { text: reply.body }]
  })
  return [{ kind: 'paragraph', runs: [{ text: t('review.export.document.thread'), bold: true }] }, { kind: 'bullets', items }]
}

export function entryBlocks(annotation: AnnotationView, t: Translator, f: Formatters): DocBlock[] {
  const heading = t('review.export.document.entry', {
    number: annotation.number,
    page: annotation.page,
    kind: t(`annotations.kinds.${annotation.kind}`),
    status: t(`review.export.document.status.${annotation.status}`),
  })
  return [
    { kind: 'heading', level: 3, text: heading },
    ...attributionLines(annotation, t, f).map((line) => paragraph(line, 'meta')),
    paragraph(annotation.body),
    ...factLines(annotation, t, f),
    ...threadBlocks(annotation, t, f),
  ]
}

const carriesEarlier = (selection: ProtocolSelection): boolean =>
  [...selection.marks, ...selection.proposals].some((annotation) => !annotation.onCurrentRevision)

function revisionPart(options: AnnotationExportOptions, selection: ProtocolSelection, t: Translator): string {
  if (options.revision === 'all') return t('review.export.document.revisions.all')
  if (!carriesEarlier(selection)) return t('review.export.document.revisions.current')
  return t(
    options.scope === 'open'
      ? 'review.export.document.revisions.all'
      : 'review.export.document.revisions.currentWithOpenFromEarlier'
  )
}

function scopeLine(options: AnnotationExportOptions, selection: ProtocolSelection, t: Translator): string {
  return [
    t(`review.export.document.scopes.${options.scope}`),
    revisionPart(options, selection, t),
    ...(options.includeProposals ? [t('review.export.document.withProposals')] : []),
  ].join(' · ')
}

function headerFacts(
  header: ProtocolHeader,
  selection: ProtocolSelection,
  options: AnnotationExportOptions,
  t: Translator,
  f: Formatters
): CoverFact[] {
  const revision = header.revision
  return [
    { label: t('review.export.document.document'), value: header.documentName },
    ...(revision
      ? [
          {
            label: t('review.export.document.revision'),
            value: t('review.export.document.revisionOf', {
              number: revision.number,
              total: revision.total,
              date: f.date(revision.createdAt),
            }),
          },
        ]
      : []),
    ...(header.projectName ? [{ label: t('review.export.document.project'), value: header.projectName }] : []),
    { label: t('review.export.document.scope'), value: scopeLine(options, selection, t) },
    { label: t('review.export.document.exportedAt'), value: f.dateTime(header.exportedAt) },
    { label: t('review.export.document.exportedBy'), value: header.exportedBy },
  ]
}

export function buildProtocol(
  header: ProtocolHeader,
  selection: ProtocolSelection,
  options: AnnotationExportOptions,
  t: Translator,
  locale: string
): Protocol {
  const f = formatters(locale, header.exportedAt)
  const { stem } = splitDocumentName(header.documentName)
  const marks: DocBlock[] =
    selection.marks.length > 0
      ? selection.marks.flatMap((annotation) => entryBlocks(annotation, t, f))
      : [paragraph(t('review.export.document.none'))]
  const proposals: DocBlock[] =
    selection.proposals.length > 0
      ? [
          { kind: 'rule' },
          { kind: 'heading', level: 2, text: t('review.export.document.proposals') },
          paragraph(t('review.export.document.proposalsNote'), 'meta'),
          ...selection.proposals.flatMap((annotation) => entryBlocks(annotation, t, f)),
        ]
      : []
  return {
    title: t('review.export.document.title', { name: stem }),
    facts: headerFacts(header, selection, options, t, f),
    body: [{ kind: 'heading', level: 2, text: t('review.export.document.marks') }, ...marks, ...proposals],
    aiProvenance: holdsAgentText(selection) ? { composite: true } : null,
  }
}

const withHeader = (protocol: Protocol): DocBlock[] => [
  { kind: 'heading', level: 1, text: protocol.title },
  ...protocol.facts.map((fact) => labelled(fact.label, fact.value)),
  ...protocol.body,
]

function runsToMarkdown(runs: readonly DocRun[]): string {
  return runs
    .map((run) => {
      if (run.mono) return `\`${run.text.replace(/`/g, '')}\``
      const text = escapeInline(run.text)
      if (!text.trim()) return text
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? ['', '', text, '']
      const marked = run.bold && run.italic ? `***${core}***` : run.bold ? `**${core}**` : run.italic ? `*${core}*` : core
      return `${lead}${marked}${trail}`
    })
    .join('')
}

const hardBreaks = (text: string, indent = ''): string => text.replace(/\n/g, `  \n${indent}`)

function blockToMarkdown(block: DocBlock): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${escapeMarkdown(block.text).replace(/\n/g, ' ')}`
    case 'paragraph': {
      const text = hardBreaks(escapeLineStarts(runsToMarkdown(block.runs)))
      if (block.style === 'quote') return text.replace(/^/gm, '> ')
      const plain = block.runs.every((run) => !run.bold && !run.italic && !run.mono)
      return block.style === 'meta' && plain && text.trim() ? `*${text.trim()}*` : text
    }
    case 'bullets':
      return block.items.map((item) => `- ${hardBreaks(escapeLineStarts(runsToMarkdown(item)), '  ')}`).join('\n')
    case 'table': {
      const cellText = (runs: DocRun[]) => runsToMarkdown(runs).replace(/\n/g, ' ')
      const width = block.head?.length ?? block.rows[0]?.length ?? 0
      const head = block.head ?? Array.from({ length: width }, () => ' ')
      return [
        `| ${head.map(escapeMarkdown).join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...block.rows.map((row) => `| ${row.map(cellText).join(' | ')} |`),
      ].join('\n')
    }
    case 'rule':
      return '---'
  }
}

export function blocksToMarkdown(blocks: readonly DocBlock[]): string {
  return `${blocks.map(blockToMarkdown).join('\n\n')}\n`
}

function pdfRenderCost(blocks: readonly DocBlock[]): number {
  const runsLength = (runs: readonly DocRun[]) => runs.reduce((sum, run) => sum + run.text.length, 0)
  return blocks.reduce((sum, block) => {
    switch (block.kind) {
      case 'heading':
        return sum + block.text.length
      case 'paragraph':
        return sum + runsLength(block.runs)
      case 'bullets':
        return sum + block.items.reduce((items, item) => items + runsLength(item) + TABLE_CELL_COST_CHARS, 0)
      case 'table':
        return sum + block.rows.flat().reduce((cells, cell) => cells + runsLength(cell) + TABLE_CELL_COST_CHARS, 0)
      case 'rule':
        return sum
    }
  }, 0)
}

type PdfDocumentElement = Parameters<typeof renderToBuffer>[0]

async function renderPdf(protocol: Protocol): Promise<Uint8Array> {
  if (pdfRenderCost(protocol.body) > MAX_MARKDOWN_PDF_CHARS) {
    throw new UnprocessableError('This Protokoll is too long for a PDF; export it as Word or Markdown.', {
      reason: 'too-long-for-pdf',
    })
  }
  const marking = protocol.aiProvenance ? aiProvenanceMarking(protocol.aiProvenance) : undefined
  const element = React.createElement(BlocksDocument, {
    cover: { title: protocol.title, facts: protocol.facts },
    blocks: protocol.body,
    keywords: marking,
  })
  const bytes = new Uint8Array(await renderToBuffer(element as unknown as PdfDocumentElement))
  return marking ? withAiProvenanceXmp(bytes, marking) : bytes
}

export function protocolFileName(
  header: Pick<ProtocolHeader, 'documentName' | 'revision'>,
  options: Pick<AnnotationExportOptions, 'format' | 'revision'>,
  t: Translator
): string {
  const name = splitDocumentName(header.documentName).stem
  const stem =
    options.revision === 'all'
      ? t('review.export.document.fileNameAll', { name })
      : header.revision
        ? t('review.export.document.fileNameRevision', { name, number: header.revision.number })
        : t('review.export.document.fileName', { name })
  return protocolFileNameOf(stem, options.format)
}

export async function renderProtocol(protocol: Protocol, format: AnnotationExportOptions['format']) {
  if (format === 'pdf') return { bytes: await renderPdf(protocol), mediaType: PDF_MEDIA_TYPE }
  if (format === 'docx') {
    const aiProvenance = protocol.aiProvenance ?? undefined
    return { bytes: renderDocx(withHeader(protocol), { aiProvenance }), mediaType: DOCX_MEDIA_TYPE }
  }
  return { bytes: new TextEncoder().encode(blocksToMarkdown(withHeader(protocol))), mediaType: MARKDOWN_MEDIA_TYPE }
}

async function currentRevision(session: AuthorizedSession, doc: Document): Promise<ProtocolRevision | null> {
  if (!doc.publishedVersionId) return null
  const versions = await listDocumentVersions(doc.id, session.organizationId)
  const current = versions.find((version) => version.id === doc.publishedVersionId)
  if (!current) return null
  return { number: current.versionNumber, total: versions.length, createdAt: current.createdAt.toISOString() }
}

async function readHeader(session: AuthorizedSession, doc: Document, now: Date): Promise<ProtocolHeader> {
  const [revision, project] = await Promise.all([
    currentRevision(session, doc),
    doc.projectId ? findProjectInOrg(doc.projectId, session.organizationId) : Promise.resolve(null),
  ])
  return {
    documentName: documentDisplayName(doc),
    revision,
    projectName: project?.name ?? null,
    exportedAt: now,
    exportedBy: session.name ?? session.email,
  }
}

export async function exportAnnotationProtocol(
  session: AuthorizedSession,
  documentId: string,
  options: AnnotationExportOptions,
  request?: Request
): Promise<ExportedProtocol> {
  const doc = await getAccessibleDocument(session, documentId, 'read')
  const [{ annotations }, header, locale] = await Promise.all([
    listAnnotations(session, doc.id),
    readHeader(session, doc, new Date()),
    getLocale(),
  ])
  const t = await getTranslations(filesCopy)
  const selection = selectMarks(annotations, options)
  const protocol = buildProtocol(header, selection, options, t, locale)
  const file = await renderProtocol(protocol, options.format)

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'document.annotations.exported',
    targetType: 'document',
    targetId: doc.id,
    metadata: {
      format: options.format,
      scope: options.scope,
      revision: options.revision,
      includeProposals: options.includeProposals,
      markCount: selection.marks.length,
      proposalCount: selection.proposals.length,
    },
    request,
  })

  return { filename: protocolFileName(header, options, t), ...file }
}
