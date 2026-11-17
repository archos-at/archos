import { canonicalOibFileName } from '@/features/chat/lib/document-names'

export interface CorpusFileCandidate {
  fileName: string
  state: string
}

const MAIN_DOC_PREFIX = 'oib-rl_'

export function resolveCorpusFileName(label: string, files: CorpusFileCandidate[]): string | null {
  const norm = label.trim().toLowerCase()
  if (!norm || !/(oib|richtlinie)/.test(norm)) return null

  const viewable = files.filter((f) => f.state !== 'removed').map((f) => f.fileName)
  const canonical = new Map(viewable.map((f) => [canonicalOibFileName(f), f]))
  const pick = (name: string | undefined): string | null => (name === undefined ? null : (canonical.get(name) ?? null))

  if (norm.includes('begriffsbestimmung')) {
    return pick([...canonical.keys()].find((f) => f.startsWith(`${MAIN_DOC_PREFIX}begriffsbestimmungen`)))
  }

  const code = /(?:^|\D)(\d(?:\.\d)?)(?:\D|$)/.exec(norm)?.[1]
  if (!code) return null

  const candidates = [...canonical.keys()].filter((f) => f.startsWith(`${MAIN_DOC_PREFIX}${code}_`) || f.startsWith(`${MAIN_DOC_PREFIX}${code}-`))
  if (candidates.length === 0) return null

  const wantsGuide = norm.includes('leitfaden')
  const guide = candidates.find((f) => f.includes('leitfaden'))
  const guideline = candidates.find((f) => !f.includes('leitfaden'))
  return pick((wantsGuide ? guide : guideline) ?? candidates[0])
}
