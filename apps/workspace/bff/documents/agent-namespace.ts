export const AGENT_DOCUMENT_NAMESPACE = 'piloti/'

export function agentDocumentFilename(documentId: string, name: string): string {
  return `${AGENT_DOCUMENT_NAMESPACE}${documentId}/${name}`
}

export function isAgentDocumentFilename(filename: string): boolean {
  return filename.startsWith(AGENT_DOCUMENT_NAMESPACE)
}
