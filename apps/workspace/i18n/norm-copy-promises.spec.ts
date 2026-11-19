/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { baseKnowledge as de } from './dictionaries/de/base-knowledge'
import { baseKnowledge as en } from './dictionaries/en/base-knowledge'

const NO_SUCH_PROMISE = [/erinnert/i, /in Antworten dazu/i, /\breminds?\b/i, /in answers that/i]

function values(node: unknown, path: string, into: [string, string][]): [string, string][] {
  if (typeof node === 'string') into.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) values(child, path ? `${path}.${key}` : key, into)
  }
  return into
}

describe.each([
  ['de', de, /Titelseite/],
  ['en', en, /title page/],
])('the norm copy in %s promises only what happens', (_locale, copy, coverPage) => {
  it('promises no reminder and no warning in answers for a due check', () => {
    const found = values(copy, '', []).filter(([, text]) => NO_SUCH_PROMISE.some((word) => word.test(text)))
    expect(found).toEqual([])
  })

  it('says a never-checked copy shows the quiet pill', () => {
    expect(copy.currency.unchecked).toContain(copy.status.checkDue)
  })

  it('says the proposal comes from the title page as well as the file name', () => {
    expect(copy.guide.upload.body).toMatch(coverPage)
  })

  it('says a failed recognition leaves the norms waiting to be confirmed, with nothing left to catch up', () => {
    expect(copy.norms.recognizeFailed).toContain(copy.filter.proposed)
    expect(copy.norms.recognizeFailed).not.toContain(copy.norms.asNorm)
  })
})
