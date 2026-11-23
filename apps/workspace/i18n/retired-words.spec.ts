/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { de } from './dictionaries'

const RETIRED: readonly { word: RegExp; use: string }[] = [
  { word: /\bAuftr(ag|äge|ags)\b/, use: 'Aufgabe (the work) or Lauf (one attempt)' },
  { word: /\bUnterhaltung(en)?\b/, use: 'Chat' },
  { word: /\bGespräch(e|s)?\b/, use: 'Chat' },
  { word: /\b[Vv]erantwortlich\b/, use: 'zuständig' },
]

const KEPT: Readonly<Record<string, string>> = {
  'projects.lifecycle.closeDialog.outcome.cancelledHint':
    'a client’s commission to the office (a withdrawn Auftrag), not work handed to the agent',
  'files.lifecycle.submit.orderLabel': 'the instruction a person gives the reviewer of a revision, not work for the agent',
  'files.lifecycle.submit.needOrder': 'the instruction a person gives the reviewer of a revision, not work for the agent',
}

function values(node: unknown, path: string, into: [string, string][]): [string, string][] {
  if (typeof node === 'string') into.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) values(child, path ? `${path}.${key}` : key, into)
  }
  return into
}

describe('retired German words', () => {
  const all = values(de, '', [])

  it('appear in no German value outside the kept ones', () => {
    const found = all.flatMap(([path, text]) =>
      KEPT[path] ? [] : RETIRED.filter(({ word }) => word.test(text)).map(({ use }) => `${path}: use ${use}`),
    )
    expect(found).toEqual([])
  })

  it('keeps only paths that exist and still carry a retired word', () => {
    const byPath = new Map(all)
    for (const path of Object.keys(KEPT)) {
      const text = byPath.get(path)
      expect(text, path).toBeDefined()
      expect(RETIRED.some(({ word }) => word.test(text ?? '')), path).toBe(true)
    }
  })
})

const NORM_PLACES = ['baseKnowledge', 'files.baseKnowledge', 'nav.sections.baseKnowledge', 'organization.baseKnowledge'] as const

describe('a norm of the Büroablage is a Norm, its place Normen & Richtlinien', () => {
  it('says „Grundlage“ nowhere in the copy of Normen & Richtlinien', () => {
    const found = values(de, '', [])
      .filter(([path]) => NORM_PLACES.some((place) => path === place || path.startsWith(`${place}.`)))
      .filter(([, text]) => /Grundlage/.test(text))
      .map(([path, text]) => `${path}: ${text}`)
    expect(found).toEqual([])
  })
})
