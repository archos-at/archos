import { PRODUCT_NAME } from '@/lib/brand'

export const AI_GENERATOR_NAME = PRODUCT_NAME

export const AI_PROVENANCE_PROPERTIES = {
  generated: 'AIGenerated',
  generator: 'AIGenerator',
  humanReviewed: 'AIHumanReviewed',
  runId: 'AIRunId',
  digitalSourceType: 'DigitalSourceType',
} as const

export const IPTC_TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

export const IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia'

export const digitalSourceTypeOf = (provenance: AiProvenance): string =>
  provenance.composite ? IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA : IPTC_TRAINED_ALGORITHMIC_MEDIA

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function aiProvenanceXmp(marking: AiProvenanceMarking): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, (char) => XML_ESCAPES[char])
  const { digitalSourceType } = AI_PROVENANCE_PROPERTIES
  const sourceType = marking.includes(IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA)
    ? IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA
    : IPTC_TRAINED_ALGORITHMIC_MEDIA
  return (
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '<rdf:Description rdf:about=""\n' +
    ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"\n' +
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
    ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n' +
    `<Iptc4xmpExt:${digitalSourceType}>${sourceType}</Iptc4xmpExt:${digitalSourceType}>\n` +
    `<xmp:CreatorTool>${escape(AI_GENERATOR_NAME)}</xmp:CreatorTool>\n` +
    `<pdf:Keywords>${escape(marking)}</pdf:Keywords>\n` +
    '</rdf:Description>\n' +
    '</rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '<?xpacket end="r"?>'
  )
}

export interface AiProvenance {
  runId?: string
  composite?: boolean
}

declare const aiProvenanceMarkingBrand: unique symbol
export type AiProvenanceMarking = string & { readonly [aiProvenanceMarkingBrand]: 'ai-provenance' }

export function aiProvenanceMarking(provenance: AiProvenance): AiProvenanceMarking {
  const parts = [
    `${AI_PROVENANCE_PROPERTIES.generated}=true`,
    `${AI_PROVENANCE_PROPERTIES.generator}=${AI_GENERATOR_NAME}`,
    `${AI_PROVENANCE_PROPERTIES.humanReviewed}=false`,
    `${AI_PROVENANCE_PROPERTIES.digitalSourceType}=${digitalSourceTypeOf(provenance)}`,
  ]
  if (provenance.runId) parts.push(`${AI_PROVENANCE_PROPERTIES.runId}=${provenance.runId}`)
  return parts.join('; ') as AiProvenanceMarking
}

export function markingIsInBytes(bytes: Uint8Array, marking: AiProvenanceMarking): boolean {
  return (
    includesBytes(bytes, new TextEncoder().encode(marking)) ||
    includesBytes(bytes, utf16beBytes(marking))
  )
}

function utf16beBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    out[index * 2] = code >> 8
    out[index * 2 + 1] = code & 0xff
  }
  return out
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  const last = haystack.length - needle.length
  for (let start = 0; start <= last; start += 1) {
    let matched = 0
    while (matched < needle.length && haystack[start + matched] === needle[matched]) matched += 1
    if (matched === needle.length) return true
  }
  return false
}
