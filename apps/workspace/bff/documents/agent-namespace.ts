export const AGENT_DOCUMENT_NAMESPACE = 'generated/'

export const NAMESPACED_AGENT_PRODUCERS: readonly string[] = ['agent_document', 'agent_file']

export function agentDocumentFilename(documentId: string, name: string): string {
  return `${AGENT_DOCUMENT_NAMESPACE}${documentId}/${name}`
}

export function isNamespacedAgentDocument(row: { authoredByProducer: string | null }): boolean {
  return row.authoredByProducer !== null && NAMESPACED_AGENT_PRODUCERS.includes(row.authoredByProducer)
}
