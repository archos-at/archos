/**
 * Which file of a polled ingest job a tracked row is, if any.
 *
 * By the server's file id when the row has one. By name otherwise, which is
 * how a row restored after a reload finds its job: it may know nothing but
 * its name.
 *
 * One row is never matched by name: an upload this session started that the
 * server has not answered yet. It holds its local `File` and has neither a
 * file id nor a job id. No job the browser is polling can be about it, because
 * a job's id is learned only from an upload's answer, and this row's answer is
 * still out. A same-named file in the polled job is an older document; taking
 * its status and file id would show the new upload as that document, and
 * removing the row would delete the other one.
 *
 * A restored row is never that row: the `File` is not persisted and a listing
 * does not carry one, so resume by name is untouched.
 */

import type { FileProgress, TrackedFile } from '../types'

type MatchedRow = Pick<TrackedFile, 'file' | 'fileName' | 'serverFileId' | 'jobId'>

function awaitsOwnUploadAnswer(row: MatchedRow): boolean {
  return row.file !== undefined && !row.serverFileId && !row.jobId
}

export function jobFileOfRow(row: MatchedRow, jobFiles: readonly FileProgress[]): FileProgress | undefined {
  const byName = !awaitsOwnUploadAnswer(row)
  return jobFiles.find((jobFile) => jobFile.file_id === row.serverFileId || (byName && jobFile.file_name === row.fileName))
}
