import { XhrNetworkError } from '@/lib/http/xhr-upload'
import { uploadRefusalOf, type UploadRefusal } from './upload-refusal'

export interface UploadFailureCopy {
  projectClosed: string
  failed: string
  network: string
  stalled: string
  timeout: string
  folderReadOnly: string
  changedMeanwhile: string
  screeningUnavailable: string
  storageFull: string
  nameTaken: (name: string) => string
  heldReplace: (name: string) => string
  tooLarge: (name: string, limitBytes: number | null) => string
  invalidType: (name: string, accepted: string[]) => string
}

export class UploadFailureSentence extends Error {
  constructor(sentence: string, options?: { cause?: unknown }) {
    super(sentence, options)
    this.name = 'UploadFailureSentence'
  }
}

export function refusalSentence(refusal: UploadRefusal, copy: UploadFailureCopy, fileName: string): string {
  switch (refusal.kind) {
    case 'held-replace':
      return copy.heldReplace(fileName)
    case 'name-taken':
      return copy.nameTaken(fileName)
    case 'project-closed':
      return copy.projectClosed
    case 'folder-read-only':
      return copy.folderReadOnly
    case 'changed-meanwhile':
      return copy.changedMeanwhile
    case 'screening-unavailable':
      return copy.screeningUnavailable
    case 'too-large':
      return copy.tooLarge(fileName, refusal.limitBytes)
    case 'storage-full':
      return copy.storageFull
    case 'invalid-type':
      return copy.invalidType(fileName, refusal.accepted)
    case 'name-stop':
    case 'other':
      return copy.failed
  }
}

export function uploadFailureSentence(error: unknown, copy: UploadFailureCopy, fileName = ''): string {
  if (error instanceof UploadFailureSentence) return error.message
  if (error instanceof XhrNetworkError) return copy[error.reason]
  const refusal = uploadRefusalOf(error)
  if (refusal) return refusalSentence(refusal, copy, fileName)
  return copy.failed
}
