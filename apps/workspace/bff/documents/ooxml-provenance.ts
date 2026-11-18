import {
  AI_GENERATOR_NAME,
  AI_PROVENANCE_PROPERTIES,
  digitalSourceTypeOf,
  type AiProvenance,
  type AiProvenanceMarking,
} from '@/lib/ai-provenance'

export const OOXML_CUSTOM_PROPERTIES_PART = 'docProps/custom.xml'
export const OOXML_CUSTOM_PROPERTIES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.custom-properties+xml'
export const OOXML_CUSTOM_PROPERTIES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties'

const CUSTOM_PROPERTIES_FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const FIRST_PID = 2

export const escapeXml = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export interface CustomProperty {
  name: string
  value: string
}

export function aiCustomProperties(provenance: AiProvenance, marking?: AiProvenanceMarking): CustomProperty[] {
  const properties: CustomProperty[] = [
    { name: AI_PROVENANCE_PROPERTIES.generated, value: '<vt:bool>true</vt:bool>' },
    { name: AI_PROVENANCE_PROPERTIES.generator, value: `<vt:lpwstr>${escapeXml(AI_GENERATOR_NAME)}</vt:lpwstr>` },
    { name: AI_PROVENANCE_PROPERTIES.humanReviewed, value: '<vt:bool>false</vt:bool>' },
    {
      name: AI_PROVENANCE_PROPERTIES.digitalSourceType,
      value: `<vt:lpwstr>${digitalSourceTypeOf(provenance)}</vt:lpwstr>`,
    },
  ]
  if (provenance.runId) {
    properties.push({
      name: AI_PROVENANCE_PROPERTIES.runId,
      value: `<vt:lpwstr>${escapeXml(provenance.runId)}</vt:lpwstr>`,
    })
  }
  if (marking) {
    properties.push({ name: AI_PROVENANCE_PROPERTIES.marking, value: `<vt:lpwstr>${escapeXml(marking)}</vt:lpwstr>` })
  }
  return properties
}

const propertyXml = (property: CustomProperty, pid: number): string =>
  `<property fmtid="${CUSTOM_PROPERTIES_FMTID}" pid="${pid}" name="${escapeXml(property.name)}">${property.value}</property>`

export function customPropertiesXml(properties: readonly CustomProperty[]): string {
  return (
    XML_DECLARATION +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    properties.map((property, index) => propertyXml(property, index + FIRST_PID)).join('') +
    '</Properties>'
  )
}

const PROPERTY_ELEMENT = /<(?:\w+:)?property\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?property>)/g

const XML_ATTRIBUTE = /\s([\w:.-]+)\s*=\s*(["'])(.*?)\2/g

const attributeOf = (tag: string, name: string): string | undefined =>
  [...tag.matchAll(XML_ATTRIBUTE)].find((match) => match[1] === name)?.[3]

export function mergeCustomPropertiesXml(existing: string | null, properties: readonly CustomProperty[]): string {
  const at = existing?.lastIndexOf('</Properties>') ?? -1
  if (!existing || at === -1 || !/<Properties\b/.test(existing)) return customPropertiesXml(properties)

  const names = new Set(properties.map((property) => escapeXml(property.name)))
  const before = existing.slice(0, at)
  const kept = before.replace(PROPERTY_ELEMENT, (element) =>
    names.has(attributeOf(element, 'name') ?? '') ? '' : element,
  )
  let pid = FIRST_PID - 1
  for (const element of kept.match(PROPERTY_ELEMENT) ?? []) {
    pid = Math.max(pid, Number(attributeOf(element, 'pid')) || 0)
  }
  const added = properties.map((property, index) => propertyXml(property, pid + 1 + index)).join('')
  const withVt = /xmlns:vt\s*=/.test(kept)
    ? kept
    : kept.replace(/<Properties\b/, '<Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"')
  return withVt + added + existing.slice(at)
}
