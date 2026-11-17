export interface DocumentText {
  text: string
  truncated: boolean
}

export async function readDocumentText(documentId: string, init?: RequestInit): Promise<DocumentText> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/text`, init)
  if (!response.ok) throw new Error(`document text ${response.status}`)
  const body = (await response.json()) as { text?: unknown; truncated?: unknown }
  if (typeof body.text !== 'string') throw new Error('document text: no text')
  return { text: body.text, truncated: body.truncated === true }
}
