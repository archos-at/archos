/**
 * @vitest-environment node
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { AnswerCard } from '@/shared/cards/schemas'

const CARD = {
  type: 'calculation',
  title: 'Brandabschnitt 3.1.1',
  steps: [{ label: 'Fläche', operation: 'product', unit: 'm²', operands: [{ label: 'Länge', value: 40 }, { label: 'Breite', value: 30 }] }],
  reference: { document: 'OIB-Richtlinie 2', section: 'Tabelle 1b' },
} as unknown as AnswerCard

describe('A2UI on the server', () => {
  it('imports the catalog contract and the card without a DOM', async () => {
    expect(typeof HTMLElement).toBe('undefined')
    await expect(import('./catalog')).resolves.toHaveProperty('preflight')
    await expect(import('./A2uiCard')).resolves.toHaveProperty('A2uiCard')
  })

  it('server-renders a card at its final size: its own layout, held invisibly under the placeholder', async () => {
    const { A2uiCard } = await import('./A2uiCard')
    const html = renderToString(<A2uiCard card={CARD} surfaceKey="m1:0" render={() => <p>card</p>} />)
    expect(html).toMatch(/data-slot="card-layout"[^>]*>[^]*<p>card<\/p>[^]*data-slot="card-placeholder"/)
    expect(html).not.toContain('data-a2ui-surface')
  })

  it('server-renders a surface A2UI will refuse as its cards, with no placeholder to swap out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { A2uiCard } = await import('./A2uiCard')
    const refused = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Carousel', children: ['a'] },
        { id: 'a', component: 'calculation', title: 'x', steps: (CARD as { steps: unknown }).steps },
      ],
    } as unknown as AnswerCard
    const html = renderToString(<A2uiCard card={refused} surfaceKey="m1:1" render={() => <p>card</p>} />)
    expect(html).toContain('<p>card</p>')
    expect(html).not.toContain('data-slot="card-placeholder"')
    expect(html).not.toContain('data-slot="card-layout"')
    warn.mockRestore()
  })
})
