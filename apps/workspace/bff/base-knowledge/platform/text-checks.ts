/**
 * The checks of the kit that another tier answers, run before the kit's
 * transaction and handed in by record id (`validateProposal`'s
 * `checkedOutside`): KC-7 for a source record (`source-checks.ts`), and, for a
 * manifestation that names a `corpusFile`, whether the base corpus holds that
 * file with the bytes the record was proposed with (ADR-0165, "Texts are
 * attached in the request").
 *
 * The second one is what removes the ordering trap. A record used to name a
 * file nobody had uploaded, and the request was reviewed, approved and
 * published before its indexing run found the file missing. Now such a record
 * is not written: the text is attached first, in the request, and the publish
 * finds it.
 *
 * It also holds the bytes still: the reviewed bytes are the published bytes. A
 * manifestation revision keeps the sha256 of the file it names, and the check
 * compares the corpus's current file with it. A first naming pins the hash the
 * corpus holds then; from there on other bytes under the name are a problem,
 * on propose, validate, submit and approve, and the indexing job compares once
 * more before it marks the file with a country (`indexing.ts`). No path of the
 * product changes a named file's bytes (`texts.ts`); the comparison is what
 * holds when something else did.
 *
 * Unknown fails closed: a corpus that cannot answer, a file without a hash and
 * a stored revision without one are problems on the manifestation, never a pass.
 */

import 'server-only'
import { getKnowledgeBaseStatus } from '@/lib/knowledge/service'
import { recordIdOf } from './records'
import { sourceChecksOf } from './source-checks'
import type { TextPin } from './text-store'
import { kitProblem, type Problem } from './validate'
import type { ProposedRecord } from './wire'

type TextRecord = Extract<ProposedRecord, { type: 'manifestation' }> & { corpusFile: string }

const ATTACH_HINT =
  'Attach the text to this manifestation with platform-knowledge-text-import (a URL on a configured source) or ' +
  'platform-knowledge-text-upload, which store the file and set corpusFile; or propose it with corpusFile null.'

const REATTACH_HINT =
  'Attach the text to this manifestation again in a draft, with platform-knowledge-text-import or platform-knowledge-text-upload: ' +
  'the text is kept under a file name of its own, and the revision names those bytes.'

/** What the kit's outside checks answer: each record's problems, and for each clean text the hash its revision keeps. */
export interface OutsideChecks {
  checks: Map<string, Problem[]>
  /** The sha256 of the bytes each manifestation names, by record id: what its revision is written with. */
  pins: Map<string, string>
  /** What a proposed source still waits for before it validates (a fixture's capture), by record id. */
  awaiting: Map<string, string[]>
}

/** The sha256 of each file the base corpus holds now, by name; a file whose bytes are gone (`removed`) is not one. */
export async function corpusFileHashes(): Promise<Map<string, string | null>> {
  const status = await getKnowledgeBaseStatus()
  return new Map(status.files.filter((file) => file.state !== 'removed').map((file) => [file.fileName, file.currentSha256 ?? null]))
}

/** The problem with `record`'s file, or the hash its revision keeps. */
function checkedText(record: TextRecord, held: Map<string, string | null> | null, pin: TextPin | undefined, pinNew: boolean): Problem | string {
  const refuse = (detail: string, hint = ATTACH_HINT) => kitProblem('KC-1', record, '/corpusFile', detail, hint)
  if (held === null) return refuse(`could not be checked: the base corpus did not answer whether it holds ${record.corpusFile}. Try again.`)
  if (!held.has(record.corpusFile)) return refuse(`names ${record.corpusFile}, which the base corpus does not hold.`)
  const current = held.get(record.corpusFile) ?? null
  if (current === null) return refuse(`could not be checked: the base corpus gave no hash for ${record.corpusFile}. Try again.`)
  // The hash this record's revision keeps for this very file; another file's says nothing about this one.
  const expected = pin?.corpusFile === record.corpusFile ? pin.sha256 : null
  if (expected === null) {
    if (pinNew) return current
    return refuse(`names ${record.corpusFile} without the hash of its bytes, so nobody can tell whether the corpus still keeps what was proposed.`, REATTACH_HINT)
  }
  if (expected !== current) {
    return refuse(
      `names ${record.corpusFile} as proposed with sha256 ${expected.slice(0, 12)}…, and the base corpus now keeps other bytes under that name (${current.slice(0, 12)}…).`,
      REATTACH_HINT,
    )
  }
  return current
}

/**
 * For every manifestation of `records` that names a file: no problem when the
 * base corpus holds it with the bytes its revision keeps (`pinned`, by record
 * id). `pinNew` is a proposal: a record that names the file for the first time
 * is pinned to what the corpus holds now. Without it (a stored request), a
 * revision that keeps no hash is a problem.
 */
export async function textChecksOf(
  records: readonly ProposedRecord[],
  pinned: ReadonlyMap<string, TextPin> = new Map(),
  pinNew = false,
): Promise<OutsideChecks> {
  const texts = records.filter((record): record is TextRecord => record.type === 'manifestation' && record.corpusFile !== null)
  const checks = new Map<string, Problem[]>()
  const pins = new Map<string, string>()
  const awaiting = new Map<string, string[]>()
  if (texts.length === 0) return { checks, pins, awaiting }
  // A corpus that did not answer leaves every text unchecked.
  const held = await corpusFileHashes().catch(() => null)
  for (const record of texts) {
    const id = recordIdOf(record)
    const answer = checkedText(record, held, pinned.get(id), pinNew)
    checks.set(id, typeof answer === 'string' ? [] : [answer])
    if (typeof answer === 'string') pins.set(id, answer)
  }
  return { checks, pins, awaiting }
}

/**
 * Every outside check of `records`, by record id (what `runKit` takes), and the hash each clean text is written with.
 * `pinNew` is a proposal into a draft; `changeRequestId` the request whose captures a source's fixture may name.
 */
export async function checksOutsideKit(
  records: readonly ProposedRecord[],
  pinned: ReadonlyMap<string, TextPin> = new Map(),
  pinNew = false,
  changeRequestId: string | null = null,
): Promise<OutsideChecks> {
  const [sources, texts] = await Promise.all([sourceChecksOf(records, changeRequestId, pinNew), textChecksOf(records, pinned, pinNew)])
  return { checks: new Map([...sources.checks, ...texts.checks]), pins: texts.pins, awaiting: sources.awaiting }
}
