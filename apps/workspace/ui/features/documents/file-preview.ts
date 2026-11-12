/**
 * The one document viewer, for a feature that opens a file it knows by id
 * (Grundlagen des Büros opens a standard as the file it is): the dialog and
 * the mapping from `GET /api/documents/{id}/status` to the file it shows. Its
 * own module and not `index.ts`, so the viewer's weight stays out of every
 * spec that imports the feature's light surface.
 */

export { FilePreviewDialog } from './components/file-preview-dialog'
export { fileItemFromStatus } from './lib/document-question'
export type { FileItem } from './components/project-file-workspace'
