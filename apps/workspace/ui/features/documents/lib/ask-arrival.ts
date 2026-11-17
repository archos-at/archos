export function newChatDropsFilePreview(documentId: string | null | undefined): boolean {
  return !documentId?.trim()
}
