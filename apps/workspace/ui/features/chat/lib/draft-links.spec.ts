import { describe, expect, test } from 'vitest'
import { draftDownloadHref, draftLinkPath } from './draft-links'

describe('a link the answer wrote to a file in the working directory', () => {
  test('a /drafts/ or /workspace/ link names the draft by its /drafts/ path', () => {
    expect(draftLinkPath('/drafts/Regenbogen.pdf')).toBe('/drafts/Regenbogen.pdf')
    expect(draftLinkPath('/workspace/Raumbuch%202027.xlsx')).toBe('/drafts/Raumbuch 2027.xlsx')
    expect(draftLinkPath('/drafts/plaene/Lageplan.svg?v=2#top')).toBe('/drafts/plaene/Lageplan.svg')
  })

  test('anything else is not a draft link', () => {
    expect(draftLinkPath('/app/projects/p1')).toBeNull()
    expect(draftLinkPath('/drafts/')).toBeNull()
    expect(draftLinkPath('/drafts/../secrets')).toBeNull()
    expect(draftLinkPath('/drafts/%E0%A4%A')).toBeNull()
  })

  test('opens as the download of this conversation’s draft', () => {
    expect(draftDownloadHref('s_1', '/drafts/Regenbogen.pdf')).toBe(
      '/api/conversations/s_1/draft/download?path=%2Fdrafts%2FRegenbogen.pdf',
    )
    expect(draftDownloadHref('s_1', '/app/chat')).toBeNull()
  })
})
