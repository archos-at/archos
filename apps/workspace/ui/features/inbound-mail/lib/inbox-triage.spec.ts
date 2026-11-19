import { afterEach, describe, expect, it } from 'vitest'
import { dismissKeyAllowed, matchesQuery, nextOpenAfter, wasDecided } from './inbox-triage'

const ids = (...names: string[]) => names.map((id) => ({ id }))

describe('nextOpenAfter', () => {
  it('opens the mail below the decided one, as a mail client advances', () => {
    expect(nextOpenAfter('b', ids('a', 'b', 'c'), ids('a', 'c'))).toBe('c')
  })

  it('takes the one above when the decided mail was the last, and nothing when none is left', () => {
    expect(nextOpenAfter('c', ids('a', 'b', 'c'), ids('a', 'b'))).toBe('b')
    expect(nextOpenAfter('a', ids('a'), [])).toBeNull()
  })

  it('skips a neighbour decided at the same time (a bulk) and falls back to what the new list holds', () => {
    expect(nextOpenAfter('b', ids('a', 'b', 'c', 'd'), ids('a', 'd'))).toBe('d')
    expect(nextOpenAfter('x', ids('a'), ids('n'))).toBe('n')
  })
})

describe('wasDecided', () => {
  it('is true only for a mail that was listed and no longer waits', () => {
    expect(wasDecided('b', ids('a', 'b'), [{ id: 'a', status: 'waiting' }])).toBe(true)
    expect(wasDecided('b', ids('a', 'b'), [{ id: 'b', status: 'waiting' }])).toBe(false)
    expect(wasDecided('z', ids('a'), [])).toBe(false)
  })
})

describe('dismissKeyAllowed', () => {
  afterEach(() => document.body.replaceChildren())

  function page(): { root: HTMLElement; openLink: HTMLElement; otherLink: HTMLElement; box: HTMLElement; button: HTMLElement; pane: HTMLElement } {
    document.body.innerHTML = `
      <div id="root">
        <ul>
          <li data-mail-id="open"><button role="checkbox" id="box"></button><a href="#" id="open-link" data-testid="inbound-mail-row-link">a</a></li>
          <li data-mail-id="other"><a href="#" id="other-link" data-testid="inbound-mail-row-link">b</a></li>
        </ul>
        <div id="pane" tabindex="0"><button id="button">Verwerfen</button></div>
      </div>
      <button id="outside">x</button>`
    const get = (id: string) => document.getElementById(id) as HTMLElement
    return { root: get('root'), openLink: get('open-link'), otherLink: get('other-link'), box: get('box'), button: get('button'), pane: get('pane') }
  }

  it('acts from the page itself, the open row and the mail', () => {
    const { root, openLink, pane } = page()
    expect(dismissKeyAllowed(document.body, root, 'open')).toBe(true)
    expect(dismissKeyAllowed(openLink, root, 'open')).toBe(true)
    expect(dismissKeyAllowed(pane, root, 'open')).toBe(true)
  })

  it('never acts on a focused button, box, another row or anything outside the E-Mail-Eingang', () => {
    const { root, otherLink, box, button } = page()
    expect(dismissKeyAllowed(box, root, 'open')).toBe(false)
    expect(dismissKeyAllowed(button, root, 'open')).toBe(false)
    expect(dismissKeyAllowed(otherLink, root, 'open')).toBe(false)
    expect(dismissKeyAllowed(document.getElementById('outside'), root, 'open')).toBe(false)
  })
})

describe('matchesQuery', () => {
  const mail = { subject: 'AW: Rückfrage Gerüststellung', senderName: 'Gerüstbau Novak', senderDomain: 'geruestbau-novak.example' }

  it('finds by sender or subject, every word, ignoring case and accents', () => {
    expect(matchesQuery(mail, 'novak')).toBe(true)
    expect(matchesQuery(mail, 'ruckfrage geruestbau')).toBe(true)
    expect(matchesQuery(mail, 'GERÜST')).toBe(true)
    expect(matchesQuery(mail, 'statik')).toBe(false)
    expect(matchesQuery({ subject: null, senderName: null, senderDomain: null }, '  ')).toBe(true)
  })
})
