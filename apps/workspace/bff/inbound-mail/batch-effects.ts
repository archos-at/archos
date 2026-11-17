import type { UploadBatchEffects } from '@/lib/db/schema/upload-batches'

export const INBOUND_ATTACHMENT_EFFECTS: Readonly<UploadBatchEffects> = Object.freeze({
  announcesCompletion: false,
  reviewsFiling: false,
  startsIntake: true,
  revisionNotice: 'all',
  runsDocumentCheck: true,
})

export const INBOUND_THREAD_APPEND_EFFECTS: Readonly<UploadBatchEffects> = Object.freeze({
  announcesCompletion: false,
  reviewsFiling: false,
  startsIntake: false,
  revisionNotice: 'marks_only',
  runsDocumentCheck: false,
})

export const ARCHIVE_THREAD_RENDER_EFFECTS: Readonly<UploadBatchEffects> = Object.freeze({
  announcesCompletion: true,
  reviewsFiling: false,
  startsIntake: false,
  revisionNotice: 'marks_only',
  runsDocumentCheck: false,
})
