import type { AnnotationAuthor, AnnotationStatus } from '@/lib/annotations/types'

export type MarkPerson = 'reader' | 'colleague'

export interface ForReaderCase {
  name: string
  authorKind: AnnotationAuthor
  status: AnnotationStatus
  assignee: MarkPerson | null
  setBy: MarkPerson
  forReader: boolean
  counted: boolean
}

export const FOR_READER_CASES: readonly ForReaderCase[] = [
  { name: 'open, the reader is Zuständige', authorKind: 'person', status: 'open', assignee: 'reader', setBy: 'colleague', forReader: true, counted: true },
  { name: 'open, set by the reader, nobody Zuständige', authorKind: 'person', status: 'open', assignee: null, setBy: 'reader', forReader: false, counted: false },
  { name: 'open, set by the reader for a colleague', authorKind: 'person', status: 'open', assignee: 'colleague', setBy: 'reader', forReader: false, counted: false },
  { name: 'open, a colleague is Zuständige', authorKind: 'person', status: 'open', assignee: 'colleague', setBy: 'colleague', forReader: false, counted: false },
  { name: 'a proposal of Piloti that names the reader', authorKind: 'piloti', status: 'proposed', assignee: 'reader', setBy: 'reader', forReader: false, counted: false },
  { name: 'a mark of Piloti taken over, the reader Zuständige', authorKind: 'piloti', status: 'open', assignee: 'reader', setBy: 'colleague', forReader: true, counted: true },
  { name: 'resolved, the reader was Zuständige', authorKind: 'person', status: 'resolved', assignee: 'reader', setBy: 'colleague', forReader: true, counted: false },
  { name: 'dismissed, the reader was Zuständige', authorKind: 'person', status: 'dismissed', assignee: 'reader', setBy: 'reader', forReader: true, counted: false },
]
