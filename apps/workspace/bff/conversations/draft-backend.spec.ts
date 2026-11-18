import { describe, expect, test } from 'vitest'
import { BadRequestError } from '@/lib/api/errors'
import { encodedDraftPath } from './draft-backend'

describe('a draft path sent to the agent host', () => {
  test('stays inside the conversation it names', () => {
    for (const path of ['../s_other', '/drafts/../../s_other', 'drafts/./x.md', 'drafts//x.md', '..']) {
      expect(() => encodedDraftPath(path), path).toThrow(BadRequestError)
    }
  })

  test('encodes each segment of an ordinary path', () => {
    expect(encodedDraftPath('/drafts/Flächen EG.xlsx')).toBe('drafts/Fl%C3%A4chen%20EG.xlsx')
    expect(encodedDraftPath('drafts/%2e%2e')).toBe('drafts/%252e%252e')
  })
})
