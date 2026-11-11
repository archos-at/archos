import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { FileName, FolderName } from './file-name'

// A canvas that measures 7px a character, and a box 140px wide: twenty characters a line.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: Array.from(text).length * 7 }),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 140.5, height: 20, top: 0, left: 0, right: 140, bottom: 20, x: 0, y: 0, toJSON: () => ({}) })
})

const drawn = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[aria-hidden="true"]')).map((line) => line.textContent ?? '')

describe('FileName', () => {
  it('draws a name that fits two lines whole, broken only between words', () => {
    const { container } = render(<FileName text="Bildschirmfoto 2026-11-03 um 12.39.png" lines={2} />)
    expect(drawn(container)).toEqual(['Bildschirmfoto 2026-', '11-03 um 12.39.png'])
    expect(container.querySelector('[data-fitted]')).toHaveAttribute('data-fitted', 'whole')
  })

  it('never breaks inside a word: a compound wider than the line loses its middle instead', () => {
    // „Baustellenbesprechun/g.pdf“ was `overflow-wrap: anywhere` on a phone's tile.
    const { container } = render(<FileName text="Bericht_01_Baustellenbesprechung.pdf" lines={2} />)
    const lines = drawn(container)
    expect(lines.join('')).not.toContain('Baustellenbesprechun')
    expect(lines.at(-1)).toMatch(/…\S*\.pdf$/)
    expect(container.querySelector('[data-fitted]')).toHaveAttribute('title', 'Bericht_01_Baustellenbesprechung.pdf')
  })

  it('keeps the extension and the end of a long name, with the ellipsis drawn', () => {
    const { container } = render(<FileName text="Rauchabschnitte_Tiefgarage_Ebene-2_Variantenvergleich_Stand-2026-11-03.pdf" />)
    const [line] = drawn(container)
    expect(line).toMatch(/^Rauchab\S*…11-03\.pdf$/)
  })

  it('reads the whole name once to assistive technology, not as fragments', () => {
    render(<FileName text="Brandschutzkonzept_Wohnhausanlage_Bauteil_C_Index-D.pdf" lines={2} />)
    expect(screen.getAllByText('Brandschutzkonzept_Wohnhausanlage_Bauteil_C_Index-D.pdf')).toHaveLength(1)
  })
})

describe('FolderName', () => {
  it('cuts a folder name at its end, with its whole name as its title', () => {
    render(<FolderName text="Planarchiv 2019–2024 (Altbestand, nicht mehr gültig)" />)
    const name = screen.getByText('Planarchiv 2019–2024 (Altbestand, nicht mehr gültig)')
    expect(name).toHaveClass('truncate')
    expect(name).toHaveAttribute('title', 'Planarchiv 2019–2024 (Altbestand, nicht mehr gültig)')
  })
})
