/**
 * What another feature may take from `components/`, `hooks/` and `lib/` here:
 * the upload and drop hooks, the drop zone, and what the E-Mail-Eingang needs
 * to file into Dateien.
 *
 * The rest of the feature's public surface is its top-level modules, imported
 * by name (`@/features/documents/store`, `/utils`, `/types`): the seam rule
 * (`feature-deep-import`) lets a feature reach those directly. This file used
 * to re-export the whole feature, so a composer that needed one hook pulled
 * the orchestrator, persistence and validation in with it, and every spec that
 * rendered the composer re-ran on a change to any of them
 * (docs/audit/blast-radius-2026-10.md §7.5). Add here only what another
 * feature imports from `components/`, `hooks/` or `lib/`.
 */

export { useFileUpload } from './hooks/use-file-upload'
export { useFileDragDrop } from './hooks/use-file-drag-drop'
export { FileUploadZone } from './components/FileUploadZone'
export { HeldUploadDecision } from './components/held-upload-decision'
export { UploadAnywayButton } from './components/upload-anyway'
// The E-Mail-Eingang files attachments into Dateien: it picks the folder, shows
// the extension chip, and links a filed document.
export { FolderPickerSheet } from './components/folder-picker-sheet'
export { FileExtChip } from './components/file-ext-chip'
export { documentFilesHref } from './lib/document-question'
// The E-Mail-Eingang offers to follow a Verlauf on the same card as the Verlauf's own tab.
export { FollowCard, FollowCardHint } from './components/mail-thread/follow-card'
export { InboundMailWaitingLine } from './components/inbound-mail-waiting-line'
