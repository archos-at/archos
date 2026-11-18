import { zipSync, type Zippable } from 'fflate'
import { aiProvenanceXmp, type AiProvenance, type AiProvenanceMarking } from '@/lib/ai-provenance'
import { serializeDiagramSvg } from '@/lib/diagrams/svg'
import { withAiProvenancePdf } from '@/lib/pdf/xmp-metadata'
import type { CheckedAgentFile } from './agent-file-check'
import { CONTENT_TYPES_PART, PACKAGE_RELS_PART, partNamed, xmlElements, type OoxmlEntries } from './ooxml-check'
import {
  aiCustomProperties,
  mergeCustomPropertiesXml,
  OOXML_CUSTOM_PROPERTIES_CONTENT_TYPE,
  OOXML_CUSTOM_PROPERTIES_PART,
  OOXML_CUSTOM_PROPERTIES_RELATIONSHIP,
} from './ooxml-provenance'
import { withPngXmp } from './png-xmp'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const DEFLATE_LEVEL = 6

const EMPTY_RELATIONSHIPS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'

function insertBefore(xml: string, closing: string, addition: string): string {
  const at = xml.lastIndexOf(closing)
  if (at === -1) throw new Error(`OOXML part has no ${closing}`)
  return xml.slice(0, at) + addition + xml.slice(at)
}

function freshRelationshipId(rels: string): string {
  const taken = new Set(xmlElements(rels, 'Relationship').map((relationship) => relationship.Id))
  let index = 1
  while (taken.has(`rIdAiProvenance${index}`)) index += 1
  return `rIdAiProvenance${index}`
}

function linkCustomProperties(entries: OoxmlEntries): string {
  const relsName = partNamed(entries, PACKAGE_RELS_PART) ?? PACKAGE_RELS_PART
  let rels = entries[relsName] ? decoder.decode(entries[relsName]) : EMPTY_RELATIONSHIPS
  const linked = xmlElements(rels, 'Relationship').find((r) => r.Type === OOXML_CUSTOM_PROPERTIES_RELATIONSHIP)
  const target = linked?.Target?.replace(/^\//, '') || OOXML_CUSTOM_PROPERTIES_PART
  if (!linked) {
    rels = insertBefore(
      rels,
      '</Relationships>',
      `<Relationship Id="${freshRelationshipId(rels)}" Type="${OOXML_CUSTOM_PROPERTIES_RELATIONSHIP}" Target="${target}"/>`,
    )
    entries[relsName] = encoder.encode(rels)
  }

  const part = partNamed(entries, target) ?? target
  const typesName = partNamed(entries, CONTENT_TYPES_PART) ?? CONTENT_TYPES_PART
  const types = decoder.decode(entries[typesName])
  const typed = xmlElements(types, 'Override').some((o) => (o.PartName ?? '').toLowerCase() === `/${part}`.toLowerCase())
  if (!typed) {
    entries[typesName] = encoder.encode(
      insertBefore(types, '</Types>', `<Override PartName="/${part}" ContentType="${OOXML_CUSTOM_PROPERTIES_CONTENT_TYPE}"/>`),
    )
  }
  return part
}

export function stampOoxml(source: OoxmlEntries, provenance: AiProvenance, marking: AiProvenanceMarking): Uint8Array {
  const entries: OoxmlEntries = { ...source }
  const part = linkCustomProperties(entries)
  const existing = entries[part] ? decoder.decode(entries[part]) : null
  entries[part] = encoder.encode(mergeCustomPropertiesXml(existing, aiCustomProperties(provenance, marking)))

  const zippable: Zippable = {}
  for (const [name, data] of Object.entries(entries)) {
    zippable[name] = [data, { level: name === part ? 0 : DEFLATE_LEVEL }]
  }
  return zipSync(zippable)
}

const xmpElement = (marking: AiProvenanceMarking): string =>
  aiProvenanceXmp(marking)
    .replace(/<\?xpacket[^?]*\?>\n?/g, '')
    .trim()

export function stampSvg(root: Parameters<typeof serializeDiagramSvg>[0], marking: AiProvenanceMarking): Uint8Array {
  const svg = serializeDiagramSvg(root)
  const open = svg.indexOf('<svg')
  const end = svg.indexOf('>', open)
  const metadata = `<metadata>${xmpElement(marking)}</metadata>`
  const stamped =
    svg[end - 1] === '/'
      ? `${svg.slice(0, end - 1)}>${metadata}</svg>${svg.slice(end + 1)}`
      : `${svg.slice(0, end + 1)}${metadata}${svg.slice(end + 1)}`
  return encoder.encode(stamped)
}

export function stampAgentFile(
  file: CheckedAgentFile,
  provenance: AiProvenance,
  marking: AiProvenanceMarking,
): Uint8Array {
  switch (file.kind) {
    case 'ooxml':
      return stampOoxml(file.entries, provenance, marking)
    case 'pdf':
      return withAiProvenancePdf(file.bytes, marking)
    case 'png':
      return withPngXmp(file.chunks, aiProvenanceXmp(marking))
    case 'svg':
      return stampSvg(file.root, marking)
  }
}
