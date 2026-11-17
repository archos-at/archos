import { describe, expect, it } from 'vitest'
import {
  buildPassageIndex,
  findOccurrences,
  findPassage,
  locatePassage,
  locatePassageInText,
  MIN_PARTIAL_HALF,
  MIN_WINDOW_SCORE,
  normalizePassage,
  passageBounds,
  type MeasureText,
  type TextChunk,
} from './passage-highlight'

const CHAR_WIDTH = 6
const LINE_HEIGHT = 12

const line = (text: string, y: number, startX = 0): TextChunk[] => {
  const chunks: TextChunk[] = []
  let x = startX
  for (const word of text.split(' ')) {
    chunks.push({ text: word, x, y, width: word.length * CHAR_WIDTH, height: LINE_HEIGHT })
    x += (word.length + 1) * CHAR_WIDTH
  }
  return chunks
}

const page = (...lines: string[]): TextChunk[] =>
  lines.flatMap((text, index) => line(text, index * LINE_HEIGHT * 1.5))

describe('normalizePassage', () => {
  it('folds ligatures and case into one comparable form', () => {
    expect(normalizePassage('Die Auﬂage ist deﬁniert')).toBe('die auflage ist definiert')
  })

  it('turns punctuation into word boundaries rather than characters to agree about', () => {
    expect(normalizePassage('Die „Auﬂage“, so § 3 Abs. 1, gilt.')).toBe(
      'die auflage so 3 abs 1 gilt'
    )
  })

  it('collapses runs of whitespace and trims the ends', () => {
    expect(normalizePassage('  der   Bescheid \n\t ist  ')).toBe('der bescheid ist')
  })

  it('rejoins a word the PDF broke across a line', () => {
    expect(normalizePassage('die Ver-\nwaltung')).toBe('die verwaltung')
    expect(normalizePassage('die Ver‐\nwaltung')).toBe('die verwaltung')
  })

  it('treats a hyphen that is not a line break as a boundary', () => {
    expect(normalizePassage('Bau-Recht')).toBe('bau recht')
    expect(normalizePassage('Seiten 3 - 5')).toBe('seiten 3 5')
  })

  it('folds precomposed and decomposed accents to the same form', () => {
    expect(normalizePassage('erf\u00fcllen')).toBe(normalizePassage('erfu\u0308llen'))
    expect(
      locatePassage(page('Die Auflage ist zu erf\u00fcllen'), 'die auflage ist zu erfu\u0308llen')
        ?.matcher
    ).toBe('exact')
  })

  it('drops soft hyphens and zero-width characters without splitting the word', () => {
    expect(normalizePassage('Ver­waltung\u200Bsakt')).toBe('verwaltungsakt')
  })
})

describe('buildPassageIndex', () => {
  it('separates adjacent runs so words do not weld together', () => {
    const index = buildPassageIndex(line('der bescheid ist', 0))
    expect(index.haystack).toBe('der bescheid ist')
  })

  it('maps every surviving character back to the run it came from', () => {
    const index = buildPassageIndex(line('der bescheid', 0))
    const first = index.chars[0]!
    expect(first).toEqual({ ch: 'd', chunk: 0, offset: 0 })
    expect(index.chars[3]).toEqual({ ch: ' ', chunk: -1, offset: -1 })
    expect(index.chars[4]).toEqual({ ch: 'b', chunk: 1, offset: 0 })
  })
})

describe('findPassage — exact', () => {
  const chunks = page(
    'Der Bescheid ist dem Antragsteller zuzustellen',
    'Die Frist betraegt vier Wochen ab Zustellung'
  )

  it('scores an exact hit at 1 and covers only the matched words', () => {
    const match = findPassage(buildPassageIndex(chunks), 'Die Frist betraegt vier Wochen')
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('exact')
    const bounds = passageBounds(match!.rects)!
    expect(bounds.y).toBe(LINE_HEIGHT * 1.5)
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBeCloseTo(30 * CHAR_WIDTH, 5)
  })

  it('matches across case, ligature, quote and punctuation differences', () => {
    const rendered = page('Die Auﬂage ist zu erfüllen')
    expect(locatePassage(rendered, 'DIE AUFLAGE IST ZU ERFÜLLEN')?.matcher).toBe('exact')
    expect(locatePassage(rendered, 'die "Auflage" ist zu erfüllen.')?.matcher).toBe('exact')
  })

  it('matches a snippet whose word the PDF hyphenated across the line break', () => {
    const chunks = [...line('die Ver-', 0), ...line('waltung entscheidet', LINE_HEIGHT * 1.5)]
    const match = locatePassage(chunks, 'die Verwaltung entscheidet')
    expect(match?.matcher).toBe('exact')
    expect(match!.rects).toHaveLength(2)
  })

  it('returns one merged band per line rather than one per run', () => {
    const match = locatePassage(
      page('Der Bescheid ist dem Antragsteller zuzustellen'),
      'Bescheid ist dem'
    )
    expect(match!.rects).toHaveLength(1)
    expect(match!.rects[0]!.width).toBeCloseTo(16 * CHAR_WIDTH, 5)
  })

  it('does not bridge a gap wide enough to be a second column', () => {
    const chunks = [
      { text: 'links', x: 0, y: 0, width: 30, height: LINE_HEIGHT },
      { text: 'rechts', x: 300, y: 0, width: 36, height: LINE_HEIGHT },
    ]
    const match = locatePassage(chunks, 'links rechts')
    expect(match!.rects).toHaveLength(2)
  })
})

describe('findPassage — where a part of a run ends', () => {
  const HELVETICA: Record<string, number> = {
    ' ': 278, a: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, k: 500, l: 222, m: 833,
    n: 556, p: 556, r: 333, s: 500, t: 278, u: 556, w: 722, y: 500, T: 611, O: 778, ä: 556,
  }
  const helvetica: MeasureText = (text) => [...text].reduce((sum, ch) => sum + (HELVETICA[ch] ?? 556), 0)
  const SECOND_LINE = 'im Treppenhaus mit einer aerodynamisch wirksamen Öffnungsfläche'
  const FONT_SIZE = 10
  const run: TextChunk = { text: SECOND_LINE, x: 64, y: 30, width: (helvetica(SECOND_LINE, undefined) * FONT_SIZE) / 1000, height: 12 }
  const firstLine: TextChunk = { text: 'Die Rauchableitung erfolgt über die Rauch- und Wärmeabzugsanlage', x: 64, y: 12, width: 320, height: 12 }
  const snippet = 'Die Rauchableitung erfolgt über die Rauch- und Wärmeabzugsanlage im Treppenhaus'
  const lit = (measure?: MeasureText) => locatePassage([firstLine, run], snippet, measure)!.rects.find((rect) => rect.y === run.y)!
  const glyphsEnd = run.x + (helvetica('im Treppenhaus', undefined) * FONT_SIZE) / 1000

  it('ends a highlight on the end of its last glyph, measured in the run\'s font', () => {
    const rect = lit(helvetica)
    expect(rect.x).toBeCloseTo(run.x, 5)
    expect(rect.x + rect.width).toBeCloseTo(glyphsEnd, 5)
  })

  it('stopped short of the „s“ when every character took an even share of the run', () => {
    const counted = lit()
    expect(glyphsEnd - (counted.x + counted.width)).toBeGreaterThan((HELVETICA.s! * FONT_SIZE) / 1000 / 2)
  })

  it('starts a highlight that begins mid-run where its first glyph begins', () => {
    const chunks: TextChunk[] = [{ ...run, y: 0 }]
    const [rect] = findOccurrences(buildPassageIndex(chunks, helvetica), 'Treppenhaus')[0]!
    expect(rect!.x).toBeCloseTo(run.x + (helvetica('im ', undefined) * FONT_SIZE) / 1000, 5)
    expect(rect!.x + rect!.width).toBeCloseTo(glyphsEnd, 5)
  })
})

describe('findPassage — anchored', () => {
  it('spans between the ends when the middle of the snippet drifted', () => {
    const chunks = page(
      'Der Antrag auf Erteilung einer Bewilligung ist schriftlich',
      'unter Anschluss der Unterlagen bei der Behoerde einzubringen'
    )
    const match = locatePassage(
      chunks,
      'einer Bewilligung ist schriftlich sammt Unterlagen bei der Behoerde einzubringen'
    )
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('anchored')
    const bounds = passageBounds(match!.rects)!
    expect(bounds.y).toBe(0)
    expect(bounds.height).toBeGreaterThan(LINE_HEIGHT)
  })

  it('refuses an anchor phrase that occurs twice on the page', () => {
    const chunks = page(
      'die Behoerde entscheidet ueber den Antrag',
      'ein weiterer Absatz ohne jeden Bezug dazu',
      'die Behoerde entscheidet ueber den Einspruch'
    )
    expect(locatePassage(chunks, 'die Behoerde entscheidet ueber den Bescheid')).toBeNull()
  })
})

describe('findPassage — windowed', () => {
  const chunks = page(
    'Vorbemerkungen zum Verfahren und seinen Beteiligten',
    'Der Sachverstaendige erstattet Befund und Gutachten ueber',
    'die Standsicherheit des bestehenden Dachstuhls'
  )

  it('finds the passage when both ends inflect differently', () => {
    const match = locatePassage(
      chunks,
      'Sachverstaendiger erstattete Befund und Gutachten ueber die Standsicherheit des bestehende Dachstuhles'
    )
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('windowed')
    expect(match!.score).toBeGreaterThanOrEqual(MIN_WINDOW_SCORE)
    expect(passageBounds(match!.rects)!.y).toBe(LINE_HEIGHT * 1.5)
  })

  it('returns null rather than pointing at an unrelated paragraph', () => {
    expect(
      locatePassage(chunks, 'Die Brandschutzabnahme wurde am fuenfzehnten Maerz durchgefuehrt')
    ).toBeNull()
  })

  it('withdraws rather than choose between two passages that score alike', () => {
    const twice = page(
      'Der Bauwerber hat die Fertigstellung der Behoerde anzuzeigen',
      'ein dazwischenliegender Absatz voellig anderen Inhalts',
      'Der Nachbar hat die Fertigstellung der Behoerde anzuzeigen'
    )
    expect(
      locatePassage(twice, 'Der Eigentuemer hat die Fertigstellung der Behoerde anzuzeigen')
    ).toBeNull()
  })
})

describe('findPassage — partial', () => {
  it('matches on its first half when the second half is on the next page', () => {
    const chunks = page(
      'Der Antrag ist bei der Behoerde schriftlich einzubringen und hat die Unterlagen zu enthalten',
      'Der Antrag ist bei der Behoerde schriftlich einzubringen sobald die Frist verstrichen ist'
    )
    const match = locatePassage(
      chunks,
      'Der Antrag ist bei der Behoerde schriftlich einzubringen und hat die Unterlagen zu enthalten ' +
        'die in der Verordnung genannt sind und vom Planverfasser stammen'
    )
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('partial')
    expect(match!.score).toBe(0.5)
    const bounds = passageBounds(match!.rects)!
    expect(bounds.y).toBe(0)
    expect(bounds.height).toBe(LINE_HEIGHT)
  })

  it('never goes partial on a snippet shorter than two halves', () => {
    const chunks = page(
      'Die Frist beginnt mit Zustellung des Bescheids',
      'Die Frist beginnt mit Ablauf der Kundmachung'
    )
    const snippet = 'Die Frist beginnt mit Zustellung ohne Aufschub'
    expect(normalizePassage(snippet).length).toBeLessThan(MIN_PARTIAL_HALF * 2)
    expect(locatePassage(chunks, snippet)).toBeNull()
  })
})

describe('findPassage — guards', () => {
  it('ignores a snippet too short to identify anything', () => {
    expect(locatePassage(page('Der Bescheid ist zuzustellen'), 'der')).toBeNull()
  })

  it('handles a page with no text layer', () => {
    expect(locatePassage([], 'Der Bescheid ist zuzustellen')).toBeNull()
  })

  it('skips runs with no measurable width', () => {
    const chunks: TextChunk[] = [
      { text: 'unsichtbar', x: 0, y: 0, width: 0, height: LINE_HEIGHT },
      ...line('Der Bescheid ist zuzustellen', LINE_HEIGHT * 1.5),
    ]
    const match = locatePassage(chunks, 'Der Bescheid ist zuzustellen')
    expect(match!.rects.every((rect) => rect.width > 0)).toBe(true)
  })
})

describe('passageBounds', () => {
  it('unions the rectangles a multi-line match produced', () => {
    expect(
      passageBounds([
        { x: 30, y: 0, width: 60, height: 12 },
        { x: 0, y: 18, width: 40, height: 12 },
      ])
    ).toEqual({ x: 0, y: 0, width: 90, height: 30 })
  })

  it('has nothing to bound when there was no match', () => {
    expect(passageBounds([])).toBeNull()
  })
})

describe('locatePassageInText', () => {
  const span = (text: string, snippet: string) => {
    const found = locatePassageInText(text, snippet)
    return found ? text.slice(found.start, found.end) : null
  }

  it('finds a passage that is simply present, and marks the words rather than the punctuation', () => {
    const text =
      'Vorher.\n\nDie nutzbare Breite eines Fluchtweges darf 1,20 m nicht unterschreiten.\n\nNachher.'
    expect(
      span(text, 'Die nutzbare Breite eines Fluchtweges darf 1,20 m nicht unterschreiten.')
    ).toBe('Die nutzbare Breite eines Fluchtweges darf 1,20 m nicht unterschreiten')
  })

  it('maps back across a ligature, which folds one source character into two', () => {
    const text = 'Die Brandschutzpﬂichten des Bauwerkes sind einzuhalten.'
    expect(span(text, 'Brandschutzpflichten des Bauwerkes')).toBe(
      'Brandschutzpﬂichten des Bauwerkes'
    )
  })

  it('maps back across the synthetic boundaries collapse inserts', () => {
    const text =
      'Die   nutzbare\n\n  Breite,  eines Fluchtweges  darf   1,20 m nicht unterschreiten.'
    expect(
      span(text, 'Die nutzbare Breite eines Fluchtweges darf 1,20 m nicht unterschreiten')
    ).toBe('Die   nutzbare\n\n  Breite,  eines Fluchtweges  darf   1,20 m nicht unterschreiten')
  })

  it('maps back across a hyphen-wrapped word, whose hyphen and break vanish', () => {
    const text = 'Die zustaendige Ver-\nwaltung entscheidet darueber.'
    expect(span(text, 'zustaendige Verwaltung entscheidet')).toBe(
      'zustaendige Ver-\nwaltung entscheidet'
    )
  })

  it('refuses a passage that is not there rather than guessing', () => {
    expect(
      locatePassageInText('Ein ganz anderer Text.', 'Die nutzbare Breite eines Fluchtweges')
    ).toBeNull()
  })

  it('refuses an ambiguous anchor — a phrase that occurs twice points at two places', () => {
    const clause = 'Die Anforderungen dieser Richtlinie sind sinngemaess anzuwenden auf alle'
    const text = `${clause} Neubauten.\n\nAnderes.\n\n${clause} Zubauten.`
    expect(locatePassageInText(text, `${clause} XXXX Neubauten`)).toBeNull()
  })

  it('says nothing for a snippet too short to identify anything', () => {
    expect(locatePassageInText('Ein Text mit ja darin.', 'ja')).toBeNull()
  })
})

describe('findOccurrences', () => {
  it('finds every occurrence, whatever its case, one rectangle set each', () => {
    const index = buildPassageIndex(page('Der Fluchtweg ist frei', 'ein zweiter FLUCHTWEG fehlt'))
    const hits = findOccurrences(index, 'fluchtweg')
    expect(hits).toHaveLength(2)
    expect(hits[0]![0]).toMatchObject({ x: 4 * CHAR_WIDTH, y: 0, width: 9 * CHAR_WIDTH })
    expect(hits[1]![0]!.y).toBe(LINE_HEIGHT * 1.5)
  })

  it('finds a word the PDF hyphenated across two lines', () => {
    const index = buildPassageIndex(page('der Flucht-', 'weg ist frei'))
    expect(findOccurrences(index, 'Fluchtweg')).toHaveLength(1)
  })

  it('does not search for a single character', () => {
    expect(findOccurrences(buildPassageIndex(page('a b c')), 'a')).toEqual([])
  })

  it('stops at the cap', () => {
    expect(findOccurrences(buildPassageIndex(page('die die die die')), 'die', 2)).toHaveLength(2)
  })
})
