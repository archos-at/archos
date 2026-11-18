export const documentFileUrl = (documentId: string): string =>
  `/api/documents/${encodeURIComponent(documentId)}/file`
