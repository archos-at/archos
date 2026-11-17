/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { hasHeader, legacyHeaderName, readHeader, withLegacyHeaderNames } from './legacy-header-names'

describe('legacy header names', () => {
  it('puts the old prefix back, keeping the casing', () => {
    expect(legacyHeaderName('x-internal-token')).toBe('x-grid-internal-token')
    expect(legacyHeaderName('X-Request-Context')).toBe('X-grid-Request-Context')
  })

  it('maps a renamed header to the name it had before', () => {
    expect(legacyHeaderName('x-chat-mode')).toBe('x-aiq-mode')
  })

  it('reads the current name first, then the old one', () => {
    expect(readHeader(new Headers({ 'x-internal-token': 'new', 'x-grid-internal-token': 'old' }), 'x-internal-token')).toBe('new')
    expect(readHeader(new Headers({ 'X-Grid-Request-Context': 'old' }), 'X-Request-Context')).toBe('old')
    expect(readHeader(new Headers(), 'x-internal-token')).toBeNull()
  })

  it('reads a renamed header under its old name when only that arrives', () => {
    expect(readHeader(new Headers({ 'x-aiq-mode': 'headless' }), 'x-chat-mode')).toBe('headless')
    expect(readHeader(new Headers({ 'x-chat-mode': 'headless', 'x-aiq-mode': 'other' }), 'x-chat-mode')).toBe('headless')
  })

  it('sees a header under either name', () => {
    expect(hasHeader(new Headers({ 'x-grid-room-peer': 'p' }), 'x-room-peer')).toBe(true)
    expect(hasHeader(new Headers(), 'x-room-peer')).toBe(false)
  })

  it('sends each header under its name and its old one, once each', () => {
    expect(withLegacyHeaderNames({ 'X-Export-Truncated': '5000' })).toEqual({
      'X-Export-Truncated': '5000',
      'X-grid-Export-Truncated': '5000',
    })
    expect(withLegacyHeaderNames({ 'x-chat-mode': 'headless' })).toEqual({
      'x-chat-mode': 'headless',
      'x-aiq-mode': 'headless',
    })
    expect(withLegacyHeaderNames({})).toEqual({})
  })
})
