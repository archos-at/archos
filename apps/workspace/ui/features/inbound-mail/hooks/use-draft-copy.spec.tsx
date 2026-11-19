import { describe, expect, it } from 'vitest'
import { renderHook } from '@/test-utils'
import { useDraftCopy } from './use-draft-copy'

const nameOf = (part: { position: number; filename: string | null; contentType: string; sizeBytes: number }): string =>
  renderHook(() => useDraftCopy()).result.current.unnamedAttachment(part)

describe('what a part without a filename is called', () => {
  it('calls a picture of the mail text so, never by its position', () => {
    expect(nameOf({ position: 6, filename: null, contentType: 'image/png', sizeBytes: 182_000 })).toBe('Picture from the mail text')
  })

  it('calls any other one an unnamed attachment with its type and size', () => {
    expect(nameOf({ position: 4, filename: null, contentType: 'application/pdf', sizeBytes: 120_000 })).toBe('Unnamed attachment (PDF, 120 kB)')
  })

  it('leaves out a type that says nothing to a reader', () => {
    expect(nameOf({ position: 4, filename: null, contentType: 'application/octet-stream', sizeBytes: 2_000_000 })).toBe('Unnamed attachment (2 MB)')
  })
})
