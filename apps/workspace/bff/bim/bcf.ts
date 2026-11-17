import 'server-only'
import { createHash } from 'node:crypto'
import { fileSlug } from '@/lib/text/latinize'
import { createZip, type ZipEntry } from './zip'
import { rulesWithOpenWork } from './rules'
import type { BimElementVerdict, BimRuleResultWithConfirmation } from './rules'

const BCF_NAMESPACE = '8f3d6a1e-5c47-4b9e-9a2d-7e1c0b4f8a53'

const DESCRIPTION_ROWS = 12

export interface BcfModelRef {
  id: string
  filename: string
  ifcProjectGlobalId: string | null
  updatedAt: Date
}

export interface BcfExportInput {
  projectId: string
  projectName: string | null
  model: BcfModelRef
  results: readonly BimRuleResultWithConfirmation[]
  author: string
}

export interface BcfExport {
  filename: string
  bytes: Uint8Array
  topics: number
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/g

const clean = (value: string): string => value.replace(ILLEGAL_XML, '')

const text = (value: string): string => xml(clean(value))

const isoDate = (value: Date): string => `${value.toISOString().slice(0, 19)}Z`

function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(namespaceBytes).update(Buffer.from(name, 'utf8')).digest()
  const bytes = Uint8Array.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const topicGuid = (projectId: string, ruleId: string): string =>
  uuidV5(BCF_NAMESPACE, `${projectId}:${ruleId}`)

const childGuid = (projectId: string, ruleId: string, kind: string): string =>
  uuidV5(BCF_NAMESPACE, `${projectId}:${ruleId}:${kind}`)

function verdictLines(verdicts: readonly BimElementVerdict[], total: number, capped: boolean): string[] {
  const lines = verdicts.slice(0, DESCRIPTION_ROWS).map((verdict) => {
    const where = verdict.storeyName ? ` (${verdict.storeyName})` : ''
    return `- ${verdict.name ?? verdict.globalId}${where}: ${verdict.reading}`
  })
  const shown = Math.min(verdicts.length, DESCRIPTION_ROWS)
  if (total > shown) {
    lines.push(`- … ${capped ? 'mindestens ' : ''}${total - shown} weitere`)
  }
  return lines
}

export function bcfDescription(result: BimRuleResultWithConfirmation, model: BcfModelRef): string {
  const sections: string[] = [
    `Anforderung: ${result.thresholdDe}`,
    `Quelle: ${result.richtlinie}, Punkt ${result.clause}`,
    `Revision: ${model.filename} (${isoDate(model.updatedAt).slice(0, 10)})`,
    '',
    `Ergebnis: ${result.passed} erfüllt, ${result.failed} nicht erfüllt, ${result.undecidable} nicht entscheidbar.`,
  ]

  if (result.failures.length > 0) {
    sections.push('', 'Nicht erfüllt:', ...verdictLines(result.failures, result.failed, result.truncated))
  }
  if (result.unknowns.length > 0) {
    sections.push(
      '',
      'Nicht entscheidbar:',
      ...verdictLines(result.unknowns, result.undecidable, result.truncated)
    )
  }
  if (result.missing.length > 0) {
    sections.push(
      '',
      'Fehlende Eigenschaften:',
      ...result.missing.map((entry) => `- ${entry.path} (${entry.elements} Bauteile)`)
    )
  }

  sections.push(
    '',
    'Aus dem Prüfbuch exportiert. Orientierung, keine Rechtsberatung — die Werte stammen aus dem Modell und ersetzen keine Prüfung.'
  )
  return sections.join('\n')
}

function topicTitle(result: BimRuleResultWithConfirmation): string {
  const verdict = result.failed > 0 ? 'nicht erfüllt' : 'nicht entscheidbar'
  return `${result.richtlinie}, Punkt ${result.clause} — ${result.titleDe} (${verdict})`
}

const IFC_GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/

function topicComponents(result: BimRuleResultWithConfirmation): string[] {
  const ids = [...result.failures, ...result.unknowns]
    .map((verdict) => verdict.globalId)
    .filter((id) => IFC_GLOBAL_ID.test(id))
  return [...new Set(ids)]
}

interface TopicComment {
  guid: string
  date: Date
  author: string
  body: string
}

function topicComments(result: BimRuleResultWithConfirmation, projectId: string): TopicComment[] {
  const confirmation = result.confirmation
  if (!confirmation) return []
  const parsed = new Date(confirmation.confirmedAt)
  const stale = result.confirmationStale
    ? ' Diese Bestätigung wurde gegen eine ANDERE Modellrevision abgegeben und gilt nicht automatisch für den hier exportierten Stand.'
    : ''
  const note = confirmation.note ? ` Anmerkung: ${confirmation.note}` : ''
  return [
    {
      guid: childGuid(projectId, result.ruleId, 'confirmation'),
      date: Number.isNaN(parsed.getTime()) ? new Date(0) : parsed,
      author: confirmation.confirmedBy,
      body: `Im Prüfbuch manuell bestätigt.${stale}${note}`,
    },
  ]
}

function markupXml(
  result: BimRuleResultWithConfirmation,
  input: BcfExportInput,
  guid: string,
  hasViewpoint: boolean
): string {
  const { model, projectId, author } = input
  const created = isoDate(model.updatedAt)
  const settled = result.confirmation !== null && !result.confirmationStale
  const status = settled ? 'Closed' : 'Open'
  const type = result.failed > 0 ? 'Issue' : 'Request'
  const priority = result.failed > 0 ? 'High' : 'Normal'

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <Header>',
    `    <File${model.ifcProjectGlobalId ? ` IfcProject="${text(model.ifcProjectGlobalId)}"` : ''} isExternal="true">`,
    `      <Filename>${text(model.filename)}</Filename>`,
    `      <Date>${created}</Date>`,
    '    </File>',
    '  </Header>',
    `  <Topic Guid="${guid}" TopicType="${type}" TopicStatus="${status}">`,
    `    <Title>${text(topicTitle(result))}</Title>`,
    `    <Priority>${priority}</Priority>`,
    `    <Labels>${text(result.richtlinie)}</Labels>`,
    `    <Labels>${result.failed > 0 ? 'nicht erfüllt' : 'nicht entscheidbar'}</Labels>`,
    `    <CreationDate>${created}</CreationDate>`,
    `    <CreationAuthor>${text(author)}</CreationAuthor>`,
    `    <Description>${text(bcfDescription(result, model))}</Description>`,
    '  </Topic>',
  ]

  for (const comment of topicComments(result, projectId)) {
    lines.push(
      `  <Comment Guid="${comment.guid}">`,
      `    <Date>${isoDate(comment.date)}</Date>`,
      `    <Author>${text(comment.author)}</Author>`,
      `    <Comment>${text(comment.body)}</Comment>`,
      '  </Comment>'
    )
  }

  if (hasViewpoint) {
    lines.push(
      `  <Viewpoints Guid="${childGuid(projectId, result.ruleId, 'viewpoint')}">`,
      '    <Viewpoint>viewpoint.bcfv</Viewpoint>',
      '  </Viewpoints>'
    )
  }

  lines.push('</Markup>', '')
  return lines.join('\n')
}

function viewpointXml(result: BimRuleResultWithConfirmation, projectId: string, globalIds: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<VisualizationInfo Guid="${childGuid(projectId, result.ruleId, 'viewpoint')}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    '  <Components>',
    '    <Selection>',
    ...globalIds.map((id) => `      <Component IfcGuid="${text(id)}" />`),
    '    </Selection>',
    '    <Visibility DefaultVisibility="true" />',
    '  </Components>',
    '</VisualizationInfo>',
    '',
  ].join('\n')
}

const VERSION_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  '  <DetailedVersion>2.1</DetailedVersion>',
  '</Version>',
  '',
].join('\n')

function slug(value: string, fallback: string): string {
  return fileSlug(value, { lowercase: false }) || fallback
}

export function buildComplianceBcf(input: BcfExportInput): BcfExport {
  const entries: ZipEntry[] = [{ path: 'bcf.version', content: VERSION_XML }]
  const topics = rulesWithOpenWork(input.results)

  for (const result of topics) {
    const guid = topicGuid(input.projectId, result.ruleId)
    const globalIds = topicComponents(result)
    entries.push({ path: `${guid}/`, content: '' })
    entries.push({
      path: `${guid}/markup.bcf`,
      content: markupXml(result, input, guid, globalIds.length > 0),
    })
    if (globalIds.length > 0) {
      entries.push({
        path: `${guid}/viewpoint.bcfv`,
        content: viewpointXml(result, input.projectId, globalIds),
      })
    }
  }

  const stem = slug(input.projectName ?? '', 'project')
  const revision = isoDate(input.model.updatedAt).slice(0, 10)
  return {
    filename: `compliance-checks-${stem}-${revision}.bcfzip`,
    bytes: createZip(entries),
    topics: topics.length,
  }
}
