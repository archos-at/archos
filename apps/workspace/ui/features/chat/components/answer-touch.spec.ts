// @disk-inputs: ui/features/chat/components/AnswerSourcesRow.tsx, ui/features/chat/components/CitationPeek.tsx, ui/features/chat/components/FindingsMatrix.tsx, ui/features/chat/components/PlanChecklist.tsx, ui/features/knowledge/components/ris-document-dialog.tsx

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { blankComments } from '../../../../scripts/check-static-utility-modifiers.mjs'
import { srcJoin } from '@/test-utils/source-tree'


const FILES = [
  'features/chat/components/PlanChecklist.tsx',
  'features/chat/components/FindingsMatrix.tsx',
  'features/chat/components/CitationPeek.tsx',
  'features/chat/components/AnswerSourcesRow.tsx',
  'features/knowledge/components/ris-document-dialog.tsx',
]

const CONTROL_TAG = /<(?:button|a)\b[^>]*>/g

const SIZED_ELSEWHERE: Record<string, string[]> = {
  'features/chat/components/PlanChecklist.tsx': [],
  'features/chat/components/FindingsMatrix.tsx': [],
  'features/chat/components/CitationPeek.tsx': ['PEEK_ACTION_CLASSES', 'COPY_ACTION_CLASSES'],
  'features/knowledge/components/ris-document-dialog.tsx': [],
  'features/chat/components/AnswerSourcesRow.tsx': [],
}

describe('hand-written controls in answer content', () => {
  it.each(FILES)('%s sizes every button and link for a finger', (file) => {
    const source = blankComments(readFileSync(srcJoin(file), 'utf8')) as string
    const offenders: string[] = []
    for (const match of source.matchAll(CONTROL_TAG)) {
      const tag = match[0]
      if (!/className=/.test(tag)) continue
      if (/pointer-coarse:/.test(tag)) continue
      if ((SIZED_ELSEWHERE[file] ?? []).some((name) => tag.includes(name))) continue
      offenders.push(tag.replace(/\s+/g, ' ').slice(0, 110))
    }
    expect(offenders).toEqual([])
  })

  it('the plan checklist removes a point and an Unterlage with a 44px control', () => {
    const source = blankComments(readFileSync(srcJoin('features/chat/components/PlanChecklist.tsx'), 'utf8')) as string
    expect(source.match(/pointer-coarse:size-11/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
