import { describe, expect, it } from 'vitest'
import { mail, messagePart, part, thread } from '@/app/dev/inbound-mail/fixtures'
import { suggestion } from '@/app/dev/inbound-mail/fixture-builders'
import { filedTo, suggestedPlaces } from './suggested-places'

const revision = { documentId: 'doc-c', name: 'S-101_C.pdf', folderPath: 'Tragwerk', nextVersion: 4 }

describe('suggestedPlaces: where one press files a waiting mail', () => {
  it('names the E-Mail-Verlauf the text joins and each folder its files go to, once', () => {
    const view = mail({
      key: 'places',
      parts: [
        messagePart({ id: 'text' }),
        part({ name: 'Bescheid.pdf', suggestion: suggestion('Behörde/Bescheide', 'Bescheid', 'Bescheid der MA 37') }),
        part({ name: 'Beilage.pdf', suggestion: suggestion('Behörde/Bescheide', null, 'Beilage') }),
        part({ name: 'S-101_D.pdf', revisionCandidate: revision }),
      ],
    })
    expect(suggestedPlaces(view)).toEqual({ text: { kind: 'thread', name: 'Stellplatznachweis' }, files: 3, folders: ['Behörde/Bescheide', 'Tragwerk'] })
  })

  it('says the text starts a new E-Mail-Verlauf when none is preselected, and the top level as an empty path', () => {
    const view = mail({
      key: 'new-thread',
      threadCandidates: [thread({ preselected: false })],
      parts: [messagePart({ id: 'text' }), part({ name: 'Foto.jpg', suggestion: suggestion('', null, 'oberste Ebene') })],
    })
    expect(suggestedPlaces(view)).toEqual({ text: { kind: 'new_thread' }, files: 1, folders: [''] })
  })

  it('leaves out what one press would not file, and says nothing of a handled mail', () => {
    const unticked = mail({ key: 'unticked', parts: [messagePart({ id: 'text', state: 'dismissed' }), part({ name: 'a.pdf', scan: 'pending' })] })
    expect(suggestedPlaces(unticked)).toBeNull()
    const handled = mail({ key: 'handled', status: 'handled', parts: [messagePart({ id: 'text', state: 'filed' })] })
    expect(suggestedPlaces(handled)).toBeNull()
  })
})

describe('filedTo: where a handled mail went', () => {
  const verlauf = { name: 'Stellplatznachweis', folderPath: 'Korrespondenz', version: 5 }
  const plan = { name: 'S-102.pdf', folderPath: 'Tragwerk', version: 1 }

  it('is the E-Mail-Verlauf its text joined, else its first filed file, else nothing the reader may see', () => {
    expect(filedTo({ parts: [part({ name: 'p.pdf', state: 'filed', filedAs: plan }), messagePart({ state: 'filed', filedAs: verlauf })] })).toEqual(verlauf)
    expect(filedTo({ parts: [messagePart({ state: 'dismissed' }), part({ name: 'p.pdf', state: 'filed', filedAs: plan })] })).toEqual(plan)
    expect(filedTo({ parts: [part({ name: 'p.pdf', state: 'filed', filedAs: null })] })).toBeNull()
  })
})
