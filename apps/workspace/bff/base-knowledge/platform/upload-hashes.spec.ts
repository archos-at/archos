/**
 * @vitest-environment node
 *
 * What a plain corpus upload would store, by name (ADR-0165): the guard on a
 * named text's bytes reads this, so a ZIP is no way around it.
 */
import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { uploadedPdfHashes } from './upload-hashes'

const sha = (text: string) => createHash('sha256').update(strToU8(text)).digest('hex')
const zip = (members: Record<string, string>) =>
  new File([zipSync(Object.fromEntries(Object.entries(members).map(([name, text]) => [name, strToU8(text)])))], 'texts.zip', { type: 'application/zip' })

describe('the hashes of a plain corpus upload', () => {
  it('is the one PDF under its name', async () => {
    expect([...(await uploadedPdfHashes(new File(['one'], 'oib-rl-1.pdf')))]).toEqual([['oib-rl-1.pdf', sha('one')]])
  })

  it('is each PDF of a ZIP under its base name, as the corpus keeps it, and nothing else', async () => {
    const hashes = await uploadedPdfHashes(zip({ 'at/oib-rl-1.pdf': 'one', 'oib-rl-2.PDF': 'two', 'readme.txt': 'no' }))
    expect(Object.fromEntries(hashes)).toEqual({ 'oib-rl-1.pdf': sha('one'), 'oib-rl-2.PDF': sha('two') })
  })

  it('gives no hash to a base name a ZIP holds twice with different bytes', async () => {
    const hashes = await uploadedPdfHashes(zip({ 'a/oib-rl-1.pdf': 'one', 'b/oib-rl-1.pdf': 'another' }))
    expect(hashes.get('oib-rl-1.pdf')).toBe('')
  })

  it('refuses a ZIP it cannot read', async () => {
    await expect(uploadedPdfHashes(new File(['not a zip'], 'texts.zip'))).rejects.toMatchObject({ status: 400 })
  })
})
