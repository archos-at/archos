/**
 * `stopReadingRow`: the upload row says cancelled only when the document does,
 * decided from the stop's own answer and never from a second request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentsStore } from '../store'
import type { TrackedFile } from '../types'
import { stopReadingRow } from './stop-reading'

const row = (status: TrackedFile['status']): TrackedFile => ({
  id: 'file_1',
  fileName: 'a.pdf',
  fileSize: 1,
  progress: 100,
  collectionName: 'chat',
  serverFileId: 'doc_1',
  status,
})

const rowStatus = () => useDocumentsStore.getState().trackedFiles.find((file) => file.id === 'file_1')?.status

const serverAnswers = (body: unknown, status = 200) => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  useDocumentsStore.setState({ trackedFiles: [row('ingesting')] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stopReadingRow', () => {
  it('writes the row cancelled when the document ended cancelled', async () => {
    serverAnswers({ id: 'doc_1', result: 'cancelled', status: 'cancelled' })

    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('cancelled')
    expect(rowStatus()).toBe('canceled')
  })

  // The queue stopped a job, and the read had ended in the same moment.
  it('leaves the row alone and says finished when the document did not end cancelled', async () => {
    serverAnswers({ id: 'doc_1', result: 'cancelled', status: 'completed' })

    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('finished')
    expect(rowStatus()).toBe('ingesting')
  })

  it('takes the answer as it comes: one request, and no status read after it', async () => {
    useDocumentsStore.setState({ trackedFiles: [row('success')] })
    const fetchSpy = serverAnswers({ id: 'doc_1', result: 'cancelled', status: 'completed' })

    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('finished')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('/api/documents/doc_1/cancel', { method: 'POST' })
    expect(rowStatus()).toBe('success')
  })

  it('overwrites a row a report settled meanwhile when the document says cancelled', async () => {
    useDocumentsStore.setState({ trackedFiles: [row('failed')] })
    serverAnswers({ id: 'doc_1', result: 'cancelled', status: 'cancelled' })

    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('cancelled')
    expect(rowStatus()).toBe('canceled')
  })

  describe('a server from before the answer carried the status', () => {
    it('writes a row that still says it is being read', async () => {
      serverAnswers({ id: 'doc_1', result: 'cancelled' })

      await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('cancelled')
      expect(rowStatus()).toBe('canceled')
    })

    it('never overwrites a row a report settled on the queue’s word alone', async () => {
      useDocumentsStore.setState({ trackedFiles: [row('success')] })
      serverAnswers({ id: 'doc_1', result: 'cancelled' })

      await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('finished')
      expect(rowStatus()).toBe('success')
    })
  })

  it.each(['finished', 'unavailable'] as const)('passes on %s and writes nothing', async (result) => {
    serverAnswers({ id: 'doc_1', result, status: 'pending' })

    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe(result)
    expect(rowStatus()).toBe('ingesting')
  })

  it('reports a request that failed, and one it cannot read', async () => {
    serverAnswers({ error: 'nope' }, 502)
    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('failed')
    serverAnswers({ result: 'stopped' })
    await expect(stopReadingRow('file_1', 'doc_1')).resolves.toBe('failed')
    expect(rowStatus()).toBe('ingesting')
  })
})
