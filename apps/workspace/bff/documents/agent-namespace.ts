export const AGENT_DOCUMENT_NAMESPACE = 'generated/'

export const NAMESPACED_AGENT_PRODUCER = 'agent_document'

export function agentDocumentFilename(documentId: string, name: string): string {
  return `${AGENT_DOCUMENT_NAMESPACE}${documentId}/${name}`
}

export function isNamespacedAgentDocument(row: { authoredByProducer: string | null }): boolean {
  return row.authoredByProducer === NAMESPACED_AGENT_PRODUCER
}
