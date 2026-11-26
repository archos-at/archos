export const AGENT_DOCUMENT_NAMESPACE = 'generated/'

export const FILES_UNDER_NAMESPACE: Readonly<Record<string, boolean>> = {
  deep_research: false,
  diagram_svg: false,
  diagram_pdf: false,
  agent_document: true,
  agent_file: true,
}

export const NAMESPACED_AGENT_PRODUCERS: readonly string[] = Object.entries(FILES_UNDER_NAMESPACE)
  .filter(([, namespaced]) => namespaced)
  .map(([producer]) => producer)

export function agentDocumentFilename(documentId: string, name: string): string {
  return `${AGENT_DOCUMENT_NAMESPACE}${documentId}/${name}`
}

export function deliveredFilename(filename: string): string {
  if (!filename.startsWith(AGENT_DOCUMENT_NAMESPACE)) return filename
  const rest = filename.slice(AGENT_DOCUMENT_NAMESPACE.length)
  const slash = rest.indexOf('/')
  return slash >= 0 && slash < rest.length - 1 ? rest.slice(slash + 1) : filename
}

export function isNamespacedAgentDocument(row: { authoredByProducer: string | null }): boolean {
  return row.authoredByProducer !== null && NAMESPACED_AGENT_PRODUCERS.includes(row.authoredByProducer)
}
