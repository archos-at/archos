/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { decodeTextBytes } from './decode-text'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('decodeTextBytes', () => {
  it('reads valid UTF-8 as UTF-8', () => {
    expect(decodeTextBytes(utf8('Maß;Höhe €'))).toEqual({ text: 'Maß;Höhe €', encoding: 'utf-8' })
  })

  it('falls back to Windows-1252 for bytes that are not UTF-8', () => {
    const cp1252 = bytes(0x4d, 0x61, 0xdf, 0x3b, 0x48, 0xf6, 0x68, 0x65, 0x20, 0x80)
    expect(decodeTextBytes(cp1252)).toEqual({ text: 'Maß;Höhe €', encoding: 'windows-1252' })
  })

  it('reads the German quotes and dash Excel writes in 0x80-0x9F', () => {
    const cp1252 = bytes(0x84, 0x48, 0xf6, 0x68, 0x65, 0x93, 0x20, 0x96, 0x20, 0x33, 0x20, 0x6d)
    expect(decodeTextBytes(cp1252)).toEqual({ text: '\u201eHöhe\u201c \u2013 3 m', encoding: 'windows-1252' })
  })

  it('maps the bytes cp1252 leaves undefined rather than refusing them', () => {
    expect(decodeTextBytes(bytes(0x41, 0x81)).text).toBe('A\u0081')
  })

  it('reads every byte of 0x80–0x9F as cp1252, whatever the runtime decoder does', () => {
    const high = Array.from({ length: 0x20 }, (_, index) => 0x80 + index)
    expect(decodeTextBytes(bytes(...high)).text).toBe('€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ')
  })

  it('lets a UTF-8 BOM decide, and strips it', () => {
    expect(decodeTextBytes(bytes(0xef, 0xbb, 0xbf, ...utf8('ä')))).toEqual({ text: 'ä', encoding: 'utf-8-sig' })
  })

  it.each([
    ['utf-16le', bytes(0xff, 0xfe, 0xe4, 0x00, 0x0a, 0x00), 'ä\n'],
    ['utf-16be', bytes(0xfe, 0xff, 0x00, 0xe4, 0x00, 0x0a), 'ä\n'],
  ] as const)('lets a %s BOM decide', (encoding, input, text) => {
    expect(decodeTextBytes(input)).toEqual({ text, encoding })
  })

  it('does not demote a UTF-8 prefix cut mid-character to cp1252', () => {
    const cut = utf8('Höhe ä').subarray(0, -1)
    expect(decodeTextBytes(cut, { truncated: true })).toEqual({ text: 'Höhe ', encoding: 'utf-8' })
  })

  it('treats an incomplete tail as not UTF-8 when the bytes are the whole file', () => {
    const cut = utf8('Höhe ä').subarray(0, -1)
    expect(decodeTextBytes(cut).encoding).toBe('windows-1252')
  })

  it('reads empty input as empty text', () => {
    expect(decodeTextBytes(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' })
  })
})
