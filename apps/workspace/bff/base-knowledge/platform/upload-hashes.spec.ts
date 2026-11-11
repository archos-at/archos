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

/**
 * A ZIP that holds `path` twice, with two contents. zipSync takes an object, so it cannot say one path twice: the
 * second member is zipped under a stand-in name of the same length, renamed in the bytes (its local header and its
 * central-directory entry).
 */
function duplicatedMember(path: string, first: string, second: string) {
  const standIn = `${path.slice(0, -1)}~`
  const bytes = zipSync({ [path]: strToU8(first), [standIn]: strToU8(second) }, { level: 0 })
  const needle = strToU8(standIn)
  for (let at = 0; at <= bytes.length - needle.length; at += 1) {
    if (needle.every((byte, offset) => bytes[at + offset] === byte)) bytes.set(strToU8(path), at)
  }
  return bytes
}

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
    await expect(uploadedPdfHashes(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'texts.zip'))).rejects.toMatchObject({ status: 400 })
  })

  it('decides ZIP or PDF by the first bytes, as the api tier does, and refuses a name that says otherwise', async () => {
    const archive = zipSync({ 'oib-rl-1.pdf': strToU8('other bytes') })
    // The reported attack: a ZIP sent as one PDF, whatever content type the part claims.
    await expect(uploadedPdfHashes(new File([archive], 'innocent.pdf', { type: 'application/zip' }))).rejects.toMatchObject({ status: 400 })
    await expect(uploadedPdfHashes(new File([archive], 'innocent.pdf', { type: 'application/pdf' }))).rejects.toMatchObject({ status: 400 })
    await expect(uploadedPdfHashes(new File(['%PDF-1.7 one'], 'texts.zip'))).rejects.toMatchObject({ status: 400 })
    // A content type alone makes nothing a ZIP.
    expect([...(await uploadedPdfHashes(new File(['one'], 'oib-rl-1.pdf', { type: 'application/zip' })))]).toEqual([['oib-rl-1.pdf', sha('one')]])
  })

  it.each([['x.pdf\0y.pdf'], ['x.pdf\0.txt'], ['a\\x.pdf'], ['a/../x.pdf']])('refuses a ZIP with a member two readers would name differently: %j', async (member) => {
    await expect(uploadedPdfHashes(zip({ [member]: 'other bytes', 'ok.pdf': 'one' }))).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a ZIP that holds one member path twice: this reader keeps the last copy, the api tier’s the first', async () => {
    const twice = duplicatedMember('F.pdf', 'the copy the api tier would store', 'the copy this tier would hash')
    await expect(uploadedPdfHashes(new File([twice], 'texts.zip'))).rejects.toMatchObject({ status: 400, message: expect.stringContaining('twice') })
    // Positive control: the same base name in two folders is two paths.
    expect((await uploadedPdfHashes(zip({ 'a/F.pdf': 'one', 'b/F.pdf': 'one' }))).get('F.pdf')).toBe(sha('one'))
  })

  it('compares names in one normal form', async () => {
    const decomposed = 'Prüfung.pdf'
    expect([...(await uploadedPdfHashes(new File(['one'], ` ${decomposed} `))).keys()]).toEqual(['Prüfung.pdf'])
    expect([...(await uploadedPdfHashes(zip({ [`a/${decomposed}`]: 'one' }))).keys()]).toEqual(['Prüfung.pdf'])
  })
})
