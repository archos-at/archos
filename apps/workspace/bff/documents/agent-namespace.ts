import type { GeneratedDocumentProducer } from './generated'

export const AGENT_DOCUMENT_NAMESPACE = 'generated/'

const FILES_UNDER_NAMESPACE = {
  deep_research: false,
  diagram_svg: false,
  diagram_pdf: false,
  agent_document: true,
  agent_file: true,
} as const satisfies Record<GeneratedDocumentProducer, boolean>

export const NAMESPACED_AGENT_PRODUCERS: readonly string[] = Object.entries(FILES_UNDER_NAMESPACE)
  .filter(([, namespaced]) => namespaced)
  .map(([producer]) => producer)

export function agentDocumentFilename(documentId: string, name: string): string {
  return `${AGENT_DOCUMENT_NAMESPACE}${documentId}/${name}`
}

export function isNamespacedAgentDocument(row: { authoredByProducer: string | null }): boolean {
  return row.authoredByProducer !== null && NAMESPACED_AGENT_PRODUCERS.includes(row.authoredByProducer)
}
