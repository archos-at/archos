/**
 * Following tray rows that no ingest job will finish, by their documents'
 * status, until each is terminal: a detached extraction (an `.ifc`, an office
 * file converting to its rendition) and a row whose job the job store forgot.
 *
 * The workspace listing settles these too, but only while a Files or
 * office-shelf page is mounted. A project upload started from the chat's side
 * panel, or one the reader walked away from, had nothing asking at all and
 * spun forever. This is the floor: per document, only for rows that carry a
 * document id, asked when the shelf's live channel says something settled
 * (`askNow`) and otherwise once per `intervalMs`.
 *
 * Part of the upload orchestrator, which owns the one instance; outside React
 * for the same reason it is.
 */

import { useDocumentsStore } from '../store'
import type { TrackedFile } from '../types'
import { isJoblessIngesting, nextStatusBatch, readDocumentStatuses, trackedPatchFromStatus } from './document-status-reads'

export interface DocumentWatch {
  /** Follow these tray rows. Idempotent per row; rows that are not jobless-and-ingesting are ignored. */
  watch(trackedIds: readonly string[]): void
  /** A hint that something settled: ask now. One that arrives during a read asks once more after it. */
  askNow(): void
  stop(): void
}

export function createDocumentWatch({
  intervalMs,
  onSettled,
}: {
  intervalMs: number
  /** At least one row came to rest in this read. */
  onSettled: () => void
}): DocumentWatch {
  const watched = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let reading = false
  let askAgain = false
  let offset = 0

  const store = () => useDocumentsStore.getState()

  /** The rows still owed an answer, pruning any somebody else settled or removed. */
  const waiting = (): TrackedFile[] => {
    const rows = new Map(store().trackedFiles.map((file) => [file.id, file]))
    const owed: TrackedFile[] = []
    for (const id of watched) {
      const row = rows.get(id)
      if (row && isJoblessIngesting(row)) owed.push(row)
      else watched.delete(id)
    }
    return owed
  }

  const schedule = (): void => {
    if (timer || reading || watched.size === 0) return
    const wait = askAgain ? 0 : intervalMs
    askAgain = false
    timer = setTimeout(() => void run(), wait)
  }

  const read = async (): Promise<void> => {
    const owed = waiting()
    if (owed.length === 0) return
    const { batch, next } = nextStatusBatch(owed.map((row) => row.serverFileId ?? ''), offset)
    offset = next
    const reads = await readDocumentStatuses(batch)

    let settled = false
    for (const row of waiting()) {
      const answer = reads.get(row.serverFileId ?? '')
      if (!answer) continue
      // Deleted meanwhile: nothing left to follow, and nothing to report.
      if (answer.kind === 'gone') {
        watched.delete(row.id)
        continue
      }
      const patch = trackedPatchFromStatus(answer.fields.status, answer.fields.errorMessage)
      if (!patch) continue
      store().updateTrackedFile(row.id, patch)
      watched.delete(row.id)
      settled = true
    }
    // Listings snapshotted while these were being read hold rows without chunks until told again.
    if (settled) onSettled()
  }

  const run = async (): Promise<void> => {
    timer = null
    reading = true
    try {
      await read()
    } finally {
      reading = false
      schedule()
    }
  }

  return {
    watch(trackedIds) {
      const rows = new Map(store().trackedFiles.map((file) => [file.id, file]))
      for (const id of trackedIds) {
        const row = rows.get(id)
        if (row && isJoblessIngesting(row)) watched.add(id)
      }
      schedule()
    },
    askNow() {
      if (reading) askAgain = true
      if (!timer) return
      clearTimeout(timer)
      void run()
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
      askAgain = false
      watched.clear()
    },
  }
}
