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

/**
 * A ZIP of `count` stored members that all point at ONE payload and each declare to unpack to nothing: one local
 * file header, and a central directory that names it `count` times under different names. A reader that copies a
 * stored member by its compressed size allocates `count` times the payload.
 */
function storedMembersOverOnePayload(count: number, payload: Uint8Array) {
  const first = strToU8('0.pdf')
  const local = new Uint8Array(30 + first.length + payload.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(4, 20, true)
  localView.setUint32(18, payload.length, true)
  localView.setUint32(22, payload.length, true)
  localView.setUint16(26, first.length, true)
  local.set(first, 30)
  local.set(payload, 30 + first.length)
  const entries = Array.from({ length: count }, (_, index) => {
    const name = strToU8(`${index}.pdf`)
    const entry = new Uint8Array(46 + name.length)
    const view = new DataView(entry.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    // Method 0 (stored) at offset 10; the compressed size is the payload's, the declared unpacked size is 0.
    view.setUint32(20, payload.length, true)
    view.setUint32(24, 0, true)
    view.setUint16(28, name.length, true)
    entry.set(name, 46)
    return entry
  })
  const directorySize = entries.reduce((sum, entry) => sum + entry.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, count, true)
  endView.setUint16(10, count, true)
  endView.setUint32(12, directorySize, true)
  endView.setUint32(16, local.length, true)
  const bytes = new Uint8Array(local.length + directorySize + end.length)
  let at = 0
  for (const part of [local, ...entries, end]) {
    bytes.set(part, at)
    at += part.length
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

  it('refuses an upload, or a ZIP whose PDFs would unpack to more than the limit, before anything is inflated', async () => {
    // 200,000 zeros deflate to a few hundred bytes: the archive is small, what it declares is not.
    const bomb = new File([zipSync({ 'zeros.pdf': new Uint8Array(200_000), 'ok.pdf': strToU8('one') })], 'texts.zip')
    expect(bomb.size).toBeLessThan(2_000)
    await expect(uploadedPdfHashes(bomb, 100_000)).rejects.toMatchObject({ status: 413 })
    // The sum counts, not only one member; what is no PDF is not unpacked and does not count.
    const many = zipSync({ 'a.pdf': new Uint8Array(60_000), 'b.pdf': new Uint8Array(60_000), 'notes.txt': new Uint8Array(500_000) })
    await expect(uploadedPdfHashes(new File([many], 'texts.zip'), 100_000)).rejects.toMatchObject({ status: 413 })
    await expect(uploadedPdfHashes(new File([new Uint8Array(100_001)], 'big.pdf'), 100_000)).rejects.toMatchObject({ status: 413 })
    // Positive control: the same archives under a limit that holds them.
    expect([...(await uploadedPdfHashes(bomb, 300_000)).keys()]).toEqual(['zeros.pdf', 'ok.pdf'])
    expect([...(await uploadedPdfHashes(new File([many], 'texts.zip'), 120_000)).keys()]).toEqual(['a.pdf', 'b.pdf'])
  })

  it('counts a stored member by the bytes it is copied from, whatever it declares to unpack to', async () => {
    // 200 entries over one 1,000-byte payload, each declaring 0 bytes: a 13 KB archive that unpacks to 200,000.
    const payload = new Uint8Array(1_000).fill(7)
    const lie = new File([storedMembersOverOnePayload(200, payload)], 'texts.zip')
    expect(lie.size).toBeLessThan(15_000)
    await expect(uploadedPdfHashes(lie, 100_000)).rejects.toMatchObject({ status: 413 })
    // Positive control: this reader reads the archive, each member as the whole payload.
    const read = await uploadedPdfHashes(lie, 200_000)
    expect(read.size).toBe(200)
    expect(new Set(read.values())).toEqual(new Set([createHash('sha256').update(payload).digest('hex')]))
  })

  it('compares names in one normal form', async () => {
    const decomposed = 'Prüfung.pdf'
    expect([...(await uploadedPdfHashes(new File(['one'], ` ${decomposed} `))).keys()]).toEqual(['Prüfung.pdf'])
    expect([...(await uploadedPdfHashes(zip({ [`a/${decomposed}`]: 'one' }))).keys()]).toEqual(['Prüfung.pdf'])
  })
})
