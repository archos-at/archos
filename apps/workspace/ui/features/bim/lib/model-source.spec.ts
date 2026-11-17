/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { createZip } from '@/lib/bim/zip'
import { looksLikeArchive, unwrapModelSource } from './model-source'

const STEP = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"
const step = (): Uint8Array => new TextEncoder().encode(STEP)

describe('looksLikeArchive', () => {
  it('reads the magic bytes and nothing else', () => {
    expect(looksLikeArchive(createZip([{ path: 'haus.ifc', content: STEP }]))).toBe(true)
    expect(looksLikeArchive(step())).toBe(false)
    expect(looksLikeArchive(new Uint8Array([0x50, 0x4b]))).toBe(false)
  })
})

describe('unwrapModelSource', () => {
  it('leaves an ordinary model alone — the cost for every `.ifc` is four bytes', async () => {
    const bytes = step()
    await expect(unwrapModelSource(bytes)).resolves.toBe(bytes)
  })

  it('opens a container, so a model stored as an archive still renders', async () => {
    const unwrapped = await unwrapModelSource(createZip([{ path: 'haus.ifc', content: STEP }]))

    expect(new TextDecoder().decode(unwrapped)).toBe(STEP)
  })

  it('hands back the input when the archive cannot be opened, rather than throwing', async () => {
    const broken = new Uint8Array(32)
    broken.set([0x50, 0x4b, 0x03, 0x04])

    await expect(unwrapModelSource(broken)).resolves.toBe(broken)
  })
})
