import type { FileProgress, TrackedFile } from '../types'

type MatchedRow = Pick<TrackedFile, 'file' | 'fileName' | 'serverFileId' | 'jobId'>

function awaitsOwnUploadAnswer(row: MatchedRow): boolean {
  return row.file !== undefined && !row.serverFileId && !row.jobId
}

export function jobFileOfRow(row: MatchedRow, jobFiles: readonly FileProgress[]): FileProgress | undefined {
  const byName = !awaitsOwnUploadAnswer(row)
  return jobFiles.find((jobFile) => jobFile.file_id === row.serverFileId || (byName && jobFile.file_name === row.fileName))
}
