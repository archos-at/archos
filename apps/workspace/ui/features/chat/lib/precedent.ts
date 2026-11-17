import type { CitedDocument } from './citations'

export const isPrecedent = (doc: CitedDocument, chatProjectId: string | null | undefined): boolean =>
  doc.project !== undefined && doc.project.id !== chatProjectId
