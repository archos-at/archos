import { LEGACY_AGENT_DOCUMENT_NAMESPACE } from './legacy-agent-namespace'

export const AGENT_DOCUMENT_NAMESPACE = 'generated/'

export const AGENT_DOCUMENT_NAMESPACES: readonly string[] = [
  AGENT_DOCUMENT_NAMESPACE,
  LEGACY_AGENT_DOCUMENT_NAMESPACE,
]

export function agentDocumentFilename(documentId: string, name: string): string {
  return `${LEGACY_AGENT_DOCUMENT_NAMESPACE}${documentId}/${name}`
}

export function isAgentDocumentFilename(filename: string): boolean {
  return AGENT_DOCUMENT_NAMESPACES.some((namespace) => filename.startsWith(namespace))
}
