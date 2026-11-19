import 'server-only'
import { proposalReading, readCover, type CoverReading } from '@/lib/base-knowledge/office/cover-page'
import { getCached } from '@/lib/cache'
import type { Document } from '@/lib/db/schema/documents'
import { storedFileOf } from '@/lib/documents/stored-copy'
import { readCoverText } from '@/lib/pdf/cover-text'
import type { RecognizedNorm } from './placement'

export const MAX_COVER_READS = 4
export const MAX_COVER_FILE_BYTES = 25 * 1024 * 1024
const COVER_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NO_COVER_TTL_MS = 24 * 60 * 60 * 1000

export type CoverFile = Pick<Document, 'id' | 'filename' | 'storageBucket' | 'storageKey' | 'contentType' | 'contentHash' | 'fileSize'>

class ReadsSpent extends Error {}

const readable = (file: CoverFile) =>
  (file.contentType === 'application/pdf' || /\.pdf$/i.test(file.filename)) && (file.fileSize ?? 0) <= MAX_COVER_FILE_BYTES

function withCover(norm: RecognizedNorm, cover: CoverReading): RecognizedNorm {
  const { values } = proposalReading(norm.fileName, norm.designation, cover)
  return values.editionLabel
    ? { ...norm, designation: values.designation ?? norm.designation, editionLabel: values.editionLabel, issuedOn: values.issuedOn ?? null }
    : { ...norm, designation: values.designation ?? norm.designation }
}

export async function withCovers(
  organizationId: string,
  norms: readonly RecognizedNorm[],
  files: ReadonlyMap<string, CoverFile>
): Promise<RecognizedNorm[]> {
  let reads = MAX_COVER_READS
  const coverOf = async (file: CoverFile): Promise<CoverReading | null> => {
    try {
      return await getCached(
        `project-norm-cover:${organizationId}:${file.id}:${file.contentHash ?? ''}`,
        COVER_TTL_MS,
        async () => {
          if (reads <= 0) throw new ReadsSpent()
          reads -= 1
          const text = await readCoverText(await storedFileOf(file, file.filename))
          return text ? readCover(text) : null
        },
        { negativeTtlMs: NO_COVER_TTL_MS }
      )
    } catch (error) {
      if (!(error instanceof ReadsSpent)) console.warn(`[office-shelf] the cover of ${file.id} could not be read`, error)
      return null
    }
  }
  return Promise.all(
    norms.map(async (norm) => {
      const file = files.get(norm.documentId)
      const cover = file && readable(file) ? await coverOf(file) : null
      return cover ? withCover(norm, cover) : norm
    })
  )
}
