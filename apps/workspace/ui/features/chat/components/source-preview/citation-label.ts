import type { CitedDocument } from '../../lib/citations'

export const documentProjectId = (doc: CitedDocument, chatProjectId: string | null): string | null =>
  doc.project?.id ?? chatProjectId

export const citationLabel = (doc: CitedDocument): string =>
  doc.project?.name ? `${doc.title} · ${doc.project.name}` : doc.title
