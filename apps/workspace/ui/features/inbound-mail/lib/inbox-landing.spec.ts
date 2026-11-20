import { describe, expect, it, vi } from 'vitest'
import { mail, messagePart, part } from '@/app/dev/inbound-mail/fixtures'
import { awaitLanding, landedPlaces, type Landing } from './inbox-landing'

const message = messagePart({ id: 'm' })
const file = part({ name: 'Plan.pdf', id: 'f' })
const sent = mail({ key: 'landing', parts: [{ ...message, state: 'filing' }, { ...file, state: 'filing' }] })
const wait = () => Promise.resolve()

describe('awaitLanding', () => {
  it('reads the mail again until its parts land, and says which did', async () => {
    const landed = { ...sent, parts: [{ ...message, state: 'filed' as const }, { ...file, state: 'filed' as const }] }
    const read = vi.fn().mockResolvedValueOnce(sent).mockResolvedValueOnce(landed)
    const result = await awaitLanding(sent, ['m', 'f'], read, { wait })
    expect(read).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ filed: ['m', 'f'], failed: [], pending: false })
  })

  it('reports a part that came back with a failure, and a full store', async () => {
    const failed = { ...sent, parts: [{ ...message, state: 'filed' as const }, { ...file, state: 'waiting' as const, lastFailure: 'quota' as const }] }
    const result = await awaitLanding(sent, ['m', 'f'], () => Promise.resolve(failed), { wait })
    expect(result).toMatchObject({ filed: ['m'], failed: ['f'], quota: true, pending: false })
  })

  it('gives up after its rounds and says it is still on its way', async () => {
    const result = await awaitLanding(sent, ['m'], () => Promise.reject(new Error('down')), { wait, rounds: 3 })
    expect(result.pending).toBe(true)
  })
})

describe('landedPlaces', () => {
  const landing = (key: string, verlauf: string, folder: string | null, extra: Partial<Landing> = {}): Landing => {
    const text = messagePart({ id: `${key}-m`, state: 'filed', documentId: `doc-${verlauf}`, filedAs: { name: verlauf, folderPath: 'Korrespondenz', version: 4 } })
    const file = part({ name: `${key}.pdf`, id: `${key}-f`, state: 'filed', documentId: `doc-${key}`, filedAs: { name: `${key}.pdf`, folderPath: folder, version: 1 } })
    return { view: mail({ key, parts: [text, file] }), filed: [text.id, file.id], failed: [], quota: false, pending: false, ...extra }
  }

  it('counts the texts per E-Mail-Verlauf and the files per folder, the top level by its name, and every document', () => {
    const places = landedPlaces([landing('a', 'Stellplatznachweis', 'Tragwerk'), landing('b', 'Stellplatznachweis', null), landing('c', 'Verfahren MA 37', 'Tragwerk')], 'Files (top level)')
    expect(places).toMatchObject({
      mails: 3,
      failed: 0,
      pending: 0,
      threads: [{ name: 'Stellplatznachweis', count: 2 }, { name: 'Verfahren MA 37', count: 1 }],
      folders: [{ name: 'Tragwerk', count: 2 }, { name: 'Files (top level)', count: 1 }],
    })
    expect(places.documentIds).toHaveLength(5)
  })

  it('counts a mail with a failed part, and one still on its way', () => {
    const places = landedPlaces([landing('a', 'X', 'Y', { failed: ['a-f'], filed: ['a-m'] }), landing('b', 'X', 'Y', { pending: true, filed: [] })], 'root')
    expect(places).toMatchObject({ mails: 1, failed: 1, pending: 1, folders: [] })
  })
})
