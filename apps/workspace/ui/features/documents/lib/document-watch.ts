import { useDocumentsStore } from '../store'
import type { TrackedFile } from '../types'
import { isJoblessIngesting, nextStatusBatch, readDocumentStatuses, trackedPatchFromStatus } from './document-status-reads'

export interface DocumentWatch {
  watch(trackedIds: readonly string[]): void
  askNow(): void
  stop(): void
}

export function createDocumentWatch({
  intervalMs,
  onSettled,
}: {
  intervalMs: number
  onSettled: () => void
}): DocumentWatch {
  const watched = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let reading = false
  let askAgain = false
  let offset = 0

  const store = () => useDocumentsStore.getState()

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
