/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { libreOfficeLikePdf, objectStreamPdf } from '@/lib/documents/agent-file.fixtures'
import { readPdfObjects } from './pdf-objects'
import { integerIn } from './pdf-structure'

describe('readPdfObjects', () => {
  it('does not read an indirect value as a number', () => {
    expect(integerIn('<< /Length 12 0 R >>', 'Length')).toBeNull()
    expect(integerIn('<< /Length 12 >>', 'Length')).toBe(12)
    expect(integerIn('<< /Width 1.5 >>', 'Width')).toBeNull()
  })

  it('resolves an indirect /Length and spans the stream data exactly', () => {
    const { objects } = readPdfObjects(libreOfficeLikePdf())
    const content = objects.find((object) => object.number === 2)
    const length = objects.find((object) => object.number === 3)
    expect(content?.data).not.toBeNull()
    expect(String((content?.data?.end ?? 0) - (content?.data?.start ?? 0))).toBe(length?.body)
    expect(objects.map((object) => object.number).sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('reads the members of an object stream and the cross-reference stream itself', () => {
    const { objects, objectStreams } = readPdfObjects(objectStreamPdf())
    expect(objects.map((object) => object.number).sort()).toEqual([5, 6])
    expect(objectStreams).toHaveLength(1)
    expect(objectStreams[0]).toContain('/Type /Catalog')
  })
})
