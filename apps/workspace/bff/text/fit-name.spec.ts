import { describe, expect, test } from 'vitest'
import { fitName, MIN_HEAD } from './fit-name'

// One unit a character: a line of 20 holds twenty characters.
const measure = (text: string) => Array.from(text).length

describe('fitName', () => {
  test('a name that fits is drawn whole, broken only after a space, an underscore or a hyphen', () => {
    expect(fitName('Bildschirmfoto 2026-11-03 um 12.39.37.png', { width: 26, lines: 2, measure })).toEqual({
      lines: ['Bildschirmfoto 2026-11-03', 'um 12.39.37.png'],
      cut: false,
    })
    expect(fitName('024-03 ANS_S-Ansicht Süd-West.pdf', { width: 20, lines: 2, measure }).lines).toEqual([
      '024-03 ANS_S-Ansicht',
      'Süd-West.pdf',
    ])
  })

  test('never breaks inside a word: a compound wider than the line is cut, not split', () => {
    // „Baustellenbesprechun/g.pdf“ was the tile breaking where the width ran out.
    const fitted = fitName('Bericht_01_Baustellenbesprechung.pdf', { width: 20, lines: 2, measure })
    for (const line of fitted.lines) expect(line.length).toBeLessThanOrEqual(20)
    expect(fitted.lines.join('')).not.toMatch(/Baustellenbesprechun$/)
    expect(fitted.cut).toBe(true)
    expect(fitted.lines.at(-1)).toMatch(/…/)
  })

  test('a long name loses its middle and keeps its extension and the end before it', () => {
    const fitted = fitName('Brandschutzkonzept_Wohnhausanlage_Bauteil_C_Index-D.pdf', { width: 22, lines: 2, measure })
    expect(fitted.cut).toBe(true)
    expect(fitted.lines.join(' ')).toMatch(/…Index-D\.pdf$/)
    expect(fitted.lines[0]).toBe('Brandschutzkonzept_')
  })

  test('the ellipsis is never lost and never stands apart from the head', () => {
    // „RStand-2026-11-03.pdf“ (the ellipsis gone) and „202…   gültig)“ (a gap after it) were MiddleTruncate's.
    const fitted = fitName('Rauchabschnitte_Tiefgarage_Ebene-2_Variantenvergleich_Stand-2026-11-03.pdf', { width: 18, lines: 2, measure })
    const drawn = fitted.lines.join('\n')
    expect(drawn).toContain('…')
    expect(drawn).not.toMatch(/ …|… /)
    const head = drawn.split('…')[0]!.replace(/\n/g, '')
    expect(head.length).toBeGreaterThanOrEqual(MIN_HEAD)
  })

  test('the head keeps at least six characters, else the end is cut instead', () => {
    const fitted = fitName('Rauchabschnittsbildung.pdf', { width: 9, lines: 1, measure })
    expect(fitted.lines).toHaveLength(1)
    expect(fitted.lines[0]).toMatch(/^Rauchabs…$/)
  })

  test('a folder name is cut at its end only', () => {
    const fitted = fitName('Planarchiv 2019–2024 (Altbestand, nicht mehr gültig)', { width: 24, lines: 1, measure, cut: 'end' })
    expect(fitted).toEqual({ lines: ['Planarchiv 2019–2024 (A…'], cut: true })
  })

  test('never draws more lines than asked for', () => {
    const fitted = fitName('Einreichplanung Bauteil A – Wohnhausanlage Holzbau Wien, Baufeld 3', { width: 16, lines: 2, measure })
    expect(fitted.lines.length).toBeLessThanOrEqual(2)
    for (const line of fitted.lines) expect(line.length).toBeLessThanOrEqual(16)
  })
})

describe('fitName with a first-line inset', () => {
  test('the first line gives up its end to the ⋯, the second keeps the whole width', () => {
    const fitted = fitName('024-03 ANS_S-Ansicht Süd-West.pdf', { width: 20, lines: 2, measure, firstLineInset: 4 })
    expect(fitted.lines[0]!.length).toBeLessThanOrEqual(16)
    expect(fitted.lines).toEqual(['024-03 ANS_S-', 'Ansicht Süd-West.pdf'])
  })
})
