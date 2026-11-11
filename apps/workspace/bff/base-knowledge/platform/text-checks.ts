/**
 * The checks of the kit that another tier answers, run before the kit's
 * transaction and handed in by record id (`validateProposal`'s
 * `checkedOutside`): KC-7 for a source record (`source-checks.ts`), and, for a
 * manifestation that names a `corpusFile`, whether the base corpus holds that
 * file (ADR-0165, "Texts are attached in the request").
 *
 * The second one is what removes the ordering trap. A record used to name a
 * file nobody had uploaded, and the request was reviewed, approved and
 * published before its indexing run found the file missing. Now such a record
 * is not written: the text is attached first, in the request, and the publish
 * finds it. Unknown fails closed: a corpus that cannot answer is a problem on
 * every manifestation it did not check.
 */

import 'server-only'
import { getKnowledgeBaseStatus } from '@/lib/knowledge/service'
import { recordIdOf } from './records'
import { sourceChecksOf } from './source-checks'
import { kitProblem, type Problem } from './validate'
import type { ProposedRecord } from './wire'

type TextRecord = Extract<ProposedRecord, { type: 'manifestation' }> & { corpusFile: string }

const ATTACH_HINT =
  'Attach the text to this manifestation with platform-knowledge-text-import (a URL on a configured source) or ' +
  'platform-knowledge-text-upload, which store the file and set corpusFile; or propose it with corpusFile null.'

/** The names of the files the base corpus holds now; a file whose bytes are gone (`removed`) is not one. */
export async function corpusFileNames(): Promise<Set<string>> {
  const status = await getKnowledgeBaseStatus()
  return new Set(status.files.filter((file) => file.state !== 'removed').map((file) => file.fileName))
}

/** For every manifestation of `records` that names a file: no problem when the base corpus holds it. */
export async function textChecksOf(records: readonly ProposedRecord[]): Promise<Map<string, Problem[]>> {
  const texts = records.filter((record): record is TextRecord => record.type === 'manifestation' && record.corpusFile !== null)
  if (texts.length === 0) return new Map()
  let held: Set<string> | null = null
  try {
    held = await corpusFileNames()
  } catch {
    // The corpus did not answer; every text stays unchecked below.
  }
  return new Map(
    texts.map((record) => {
      const detail =
        held === null
          ? `could not be checked: the base corpus did not answer whether it holds ${record.corpusFile}. Try again.`
          : `names ${record.corpusFile}, which the base corpus does not hold.`
      return [recordIdOf(record), held?.has(record.corpusFile) ? [] : [kitProblem('KC-1', record, '/corpusFile', detail, ATTACH_HINT)]]
    }),
  )
}

/** Every outside check of `records`, by record id: what `runKit` takes. */
export async function checksOutsideKit(records: readonly ProposedRecord[]): Promise<Map<string, Problem[]>> {
  const [sources, texts] = await Promise.all([sourceChecksOf(records), textChecksOf(records)])
  return new Map([...sources, ...texts])
}
