/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { foldDiacritics, latinize, transliterateGerman } from './latinize'

describe('transliterateGerman', () => {
  it('spells the letters Unicode cannot decompose', () => {
    expect(transliterateGerman('Beispielstraße')).toBe('Beispielstrasse')
    expect(transliterateGerman('Grünanger Höfe')).toBe('Gruenanger Hoefe')
    expect(transliterateGerman('Außenwand')).toBe('Aussenwand')
  })

  it('keeps case, because a filename does', () => {
    expect(transliterateGerman('ÖBB Ärztezentrum')).toBe('OeBB Aerztezentrum')
    expect(transliterateGerman('Über')).toBe('Ueber')
  })

  it('matches a decomposed umlaut too', () => {
    expect(transliterateGerman('Grünanger'.normalize('NFD'))).toBe('Gruenanger')
  })

  it('leaves every other accent for the generic pass', () => {
    expect(transliterateGerman('Dvořák')).toBe('Dvořák')
  })

  it('handles the capital sharp S', () => {
    expect(transliterateGerman('STRAẞE')).toBe('STRASSE')
  })
})

describe('foldDiacritics', () => {
  it('drops marks whatever language put them there', () => {
    expect(foldDiacritics('Dvořák')).toBe('Dvorak')
    expect(foldDiacritics('Café Frýdek')).toBe('Cafe Frydek')
  })

  it('expands compatibility forms, which is what a filename wants', () => {
    expect(foldDiacritics('ﬁnal')).toBe('final')
  })

  it('spells the Latin letters NFKD cannot decompose either', () => {
    expect(foldDiacritics('Øresund')).toBe('Oeresund')
    expect(foldDiacritics('Łódź')).toBe('Lodz')
    expect(foldDiacritics('Ærø')).toBe('Aeroe')
    expect(foldDiacritics('Đakovo')).toBe('Dakovo')
    expect(foldDiacritics('Œuvre')).toBe('Oeuvre')
  })

  it('cannot spell German, which is why it is not used alone', () => {
    expect(foldDiacritics('Grünanger')).toBe('Grunanger')
    expect(foldDiacritics('Straße')).toBe('Straße')
  })
})

describe('latinize', () => {
  it('spells German and folds the rest, in that order', () => {
    expect(latinize('Beispielstraße 14')).toBe('Beispielstrasse 14')
    expect(latinize('Grünanger')).toBe('Gruenanger')
    expect(latinize('Rezidence Dvořák')).toBe('Rezidence Dvorak')
  })

  it('would lose the German spelling if the order were reversed', () => {
    expect(latinize('Grünanger')).not.toBe(transliterateGerman(foldDiacritics('Grünanger')))
  })

  it('passes plain ASCII through untouched', () => {
    expect(latinize('Wohnbau Nord 2026')).toBe('Wohnbau Nord 2026')
  })

  it('leaves a script it cannot latinize alone rather than mangling it', () => {
    expect(latinize('日本橋')).toBe('日本橋')
  })
})
