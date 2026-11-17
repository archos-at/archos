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

export interface OutsideChecks {
  checks: Map<string, Problem[]>
  pins: Map<string, string>
  awaiting: Map<string, string[]>
}

export async function corpusFileHashes(): Promise<Map<string, string | null>> {
  const status = await getKnowledgeBaseStatus()
  return new Map(status.files.filter((file) => file.state !== 'removed').map((file) => [file.fileName, file.currentSha256 ?? null]))
}

function checkedText(record: TextRecord, held: Map<string, string | null> | null, pin: TextPin | undefined, pinNew: boolean): Problem | string {
  const refuse = (detail: string, hint = ATTACH_HINT) => kitProblem('KC-1', record, '/corpusFile', detail, hint)
  if (held === null) return refuse(`could not be checked: the base corpus did not answer whether it holds ${record.corpusFile}. Try again.`)
  if (!held.has(record.corpusFile)) return refuse(`names ${record.corpusFile}, which the base corpus does not hold.`)
  const current = held.get(record.corpusFile) ?? null
  if (current === null) return refuse(`could not be checked: the base corpus gave no hash for ${record.corpusFile}. Try again.`)
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
  const held = await corpusFileHashes().catch(() => null)
  for (const record of texts) {
    const id = recordIdOf(record)
    const answer = checkedText(record, held, pinned.get(id), pinNew)
    checks.set(id, typeof answer === 'string' ? [] : [answer])
    if (typeof answer === 'string') pins.set(id, answer)
  }
  return { checks, pins, awaiting }
}

export async function checksOutsideKit(
  records: readonly ProposedRecord[],
  pinned: ReadonlyMap<string, TextPin> = new Map(),
  pinNew = false,
  changeRequestId: string | null = null,
): Promise<OutsideChecks> {
  const [sources, texts] = await Promise.all([sourceChecksOf(records, changeRequestId, pinNew), textChecksOf(records, pinned, pinNew)])
  return { checks: new Map([...sources.checks, ...texts.checks]), pins: texts.pins, awaiting: sources.awaiting }
}
