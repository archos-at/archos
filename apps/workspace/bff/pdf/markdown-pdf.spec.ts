/**
 * @vitest-environment node
 *
 * The markdown → PDF renderer, read back by a parser that is not react-pdf.
 *
 * Every assertion here goes through `test-utils/read-pdf`, which parses the
 * produced bytes with pdf.js. That is the whole point: an assertion on the
 * react-pdf element tree proves a `<Text>` was described, never that the words
 * reached a file somebody can open. For the marking this feature exists to
 * carry, "described" is not the claim — the claim is that the sentence is on
 * page one of the artifact that reaches the Behörde.
 *
 * `@vitest-environment node` is load-bearing: `@react-pdf/renderer` has a
 * `browser` field in its package.json, and under the suite's default happy-dom
 * environment the bundler resolves the web build, whose `renderToStream`
 * throws "a web specific API".
 */

import { describe, expect, it } from 'vitest'
import { readPdf, normalizePdfText } from '@/test-utils/read-pdf'
import {
  AI_GENERATOR_NAME,
  IPTC_TRAINED_ALGORITHMIC_MEDIA,
  aiProvenanceMarking,
} from '@/lib/ai-provenance'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'
import {
  MAX_MARKDOWN_PDF_CHARS,
  TABLE_CELL_COST_CHARS,
  fingerprintMarkdownPdfInput,
  markdownRenderCost,
  MarkdownTooLongError,
  PDF_MEDIA_TYPE,
  renderMarkdownPdf,
} from './markdown-pdf'
import { PRODUCT_NAME } from '@/lib/brand'

const WORDMARK = PRODUCT_NAME.toUpperCase()

const de = answerExportCopy.messages.de
const en = answerExportCopy.messages.en

const DIAGRAM_PLACEHOLDER = 'Zeichnung hier nicht wiedergegeben.'

const MARKING = aiProvenanceMarking({ runId: 'run_7' })

const BASE = { diagramPlaceholder: DIAGRAM_PLACEHOLDER, marking: MARKING }

const REPORT = '# Brandschutz Straßenhäuser\n\nDie Fluchtwegbreite beträgt 1,20 m.\n'


const magic = (bytes: Uint8Array): string =>
  new TextDecoder('latin1').decode(bytes.subarray(0, 5))

describe('renderMarkdownPdf', () => {
  it('produces a file pdf.js can open, with the markdown’s own words in it', async () => {
    const bytes = await renderMarkdownPdf(REPORT, BASE)

    expect(magic(bytes)).toBe('%PDF-')
    expect(PDF_MEDIA_TYPE).toBe('application/pdf')

    const pdf = await readPdf(bytes)
    expect(pdf.pageCount).toBe(2)
    expect(pdf.text).toContain('Brandschutz Straßenhäuser')
    expect(pdf.text).toContain('Die Fluchtwegbreite beträgt 1,20 m.')
  })

  it('cannot be called without a marking', () => {
    const unmarked = () =>
      // @ts-expect-error -- `marking` is required: an unmarked PDF is not a call this module offers.
      renderMarkdownPdf(REPORT, { diagramPlaceholder: DIAGRAM_PLACEHOLDER })
    expect(typeof unmarked).toBe('function')
  })

  it('prints the notice the caller supplied, on the first page', async () => {
    const bytes = await renderMarkdownPdf(REPORT, {
      ...BASE,
      marking: MARKING,
      locale: 'de',
    })
    const pdf = await readPdf(bytes)

    expect(pdf.text).toContain(normalizePdfText(de.aiNotice.title))
    expect(pdf.text).toContain(normalizePdfText(de.aiNotice.body))
    expect(pdf.text.indexOf(de.aiNotice.title)).toBeLessThan(
      pdf.text.indexOf('Die Fluchtwegbreite')
    )
  })

  it.each([
    ['de', de.aiNotice],
    ['en', en.aiNotice],
  ])('carries the %s notice through to the rendered page', async (_locale, notice) => {
    const pdf = await readPdf(
      await renderMarkdownPdf(REPORT, { ...BASE, marking: MARKING, locale: _locale })
    )

    expect(pdf.text).toContain(normalizePdfText(notice.title))
    expect(pdf.text).toContain(normalizePdfText(notice.body))
  })

  it('prints no header and no section when the caller supplies neither', async () => {
    const pdf = await readPdf(await renderMarkdownPdf(REPORT, BASE))

    expect(pdf.pageCount).toBe(2)
    expect(pdf.text.startsWith(WORDMARK)).toBe(true)
    expect(pdf.text).toContain(normalizePdfText(en.aiNotice.title))
    expect(pdf.text).toContain(`${WORDMARK} 2 / 2`)
    expect(pdf.text.endsWith('Die Fluchtwegbreite beträgt 1,20 m.')).toBe(true)
  })



  describe('the machine-readable marking', () => {
    it('writes the same property names the .docx custom properties use', async () => {
      const bytes = await renderMarkdownPdf(REPORT, {
        ...BASE,
        title: 'Brandschutz Straßenhäuser',
        marking: MARKING,
        locale: 'de',
      })
      const pdf = await readPdf(bytes)

      expect(pdf.info.Keywords).toBe(
        `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia; AIRunId=run_7`
      )
      expect(pdf.info.Creator).toBe(AI_GENERATOR_NAME)
      expect(pdf.xmp['iptc4xmpext:digitalsourcetype']).toBe(IPTC_TRAINED_ALGORITHMIC_MEDIA)
      expect(pdf.xmp['pdf:keywords']).toBe(pdf.info.Keywords)
      expect(pdf.info.Title).toBe('Brandschutz Straßenhäuser')
      expect(pdf.info.Subject).toBe(de.aiNotice.title)
    })

    it('omits the run id rather than writing an empty one', async () => {
      const pdf = await readPdf(
        await renderMarkdownPdf(REPORT, { ...BASE, marking: aiProvenanceMarking({}) })
      )

      expect(pdf.info.Keywords).toBe(
        `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`
      )
    })
  })

  describe('the admission bound', () => {
    const proseOf = (size: number) =>
      'Die Fluchtwegbreite betraegt 1,20 m und ist damit ausreichend bemessen. '.repeat(
        Math.ceil(size / 72)
      ).slice(0, size)

    const tableOf = (rows: number) =>
      `| Bauteil | Anforderung | Nachweis | Quelle |\n|---|---|---|---|\n` +
      '| Trennwand | REI 90 | Pruefzeugnis | OIB-RL 2 |\n'.repeat(rows)

    it('prices a table cell above a prose character', () => {
      const prose = proseOf(4000)
      const table = tableOf(40)

      expect(markdownRenderCost(prose)).toBe(prose.length)
      expect(markdownRenderCost(table)).toBeGreaterThan(table.length * 2)
      expect(markdownRenderCost(table) - table.length).toBe(42 * 4 * TABLE_CELL_COST_CHARS)
    })

    it('renders a report the old character cap refused', async () => {
      const bytes = await renderMarkdownPdf(proseOf(128 * 1024), BASE)

      expect(new TextDecoder('latin1').decode(bytes.subarray(0, 5))).toBe('%PDF-')
    }, 60_000)

    it('refuses one unit of cost more than the limit, by name', async () => {
      const markdown = proseOf(MAX_MARKDOWN_PDF_CHARS + 1)

      await expect(renderMarkdownPdf(markdown, BASE)).rejects.toThrow(MarkdownTooLongError)
      await expect(renderMarkdownPdf(markdown, BASE)).rejects.toMatchObject({
        length: MAX_MARKDOWN_PDF_CHARS + 1,
        limit: MAX_MARKDOWN_PDF_CHARS,
      })
    })

    it('still refuses a table-heavy document at very nearly its old size', async () => {
      const markdown = tableOf(1500)

      expect(markdown.length).toBeLessThan(96 * 1024)
      await expect(renderMarkdownPdf(markdown, BASE)).rejects.toThrow(MarkdownTooLongError)
    })

    it('refuses without rendering, which is the only place a refusal can be', async () => {
      const table = '| a | b |\n|---|---|\n| Fluchtweg | 1,20 m |\n\n'
      const markdown = table.repeat(Math.ceil((2 * 1024 * 1024) / table.length))
      const started = Date.now()

      await expect(renderMarkdownPdf(markdown, BASE)).rejects.toThrow(MarkdownTooLongError)

      expect(Date.now() - started).toBeLessThan(1000)
    })
  })

  describe('fingerprintMarkdownPdfInput', () => {
    const markdown = [
      '# Fluchtwege',
      '',
      'Die Breite betraegt 1,20 m.',
      '',
      '| Bauteil | Nachweis |',
      '|---|---|',
      '| Trennwand | Pruefzeugnis |',
      '',
      '```mermaid',
      'flowchart TD',
      '```',
      '',
      '## Bewertung',
      '',
    ].join('\n')

    it('counts the constructs the layout pass is sensitive to', () => {
      const fingerprint = fingerprintMarkdownPdfInput(
        markdown,
        [{ type: 'summary' }, { type: 'verdict_header' }, { type: 'summary' }],
        1234
      )

      expect(fingerprint).toMatchObject({
        chars: markdown.length,
        cost: 1234,
        mermaidFences: 1,
        tableRows: 3,
        headings: 2,
        cardTypes: ['summary', 'verdict_header'],
      })
      expect(fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/)
    })

    it('hashes equal documents equally and unequal ones differently', () => {
      expect(fingerprintMarkdownPdfInput(markdown, []).sha256).toBe(
        fingerprintMarkdownPdfInput(markdown, []).sha256
      )
      expect(fingerprintMarkdownPdfInput(markdown, []).sha256).not.toBe(
        fingerprintMarkdownPdfInput(`${markdown}x`, []).sha256
      )
    })

    it('tolerates cards it has never seen', () => {
      expect(fingerprintMarkdownPdfInput('text', [null, 'x', {}, { type: 7 }]).cardTypes).toEqual(
        []
      )
    })
  })

  describe('hostile payloads', () => {
    const hostileCards = [
      { type: 'mystery', content: { nested: { deep: [1, 2, { x: 'y' }] } } },
      { type: 'mystery', count: 42, flag: true, nothing: null },
      { type: 'mystery', list: [{ a: 1 }, 'two', [3]] },
      'a bare string, not a card at all',
      42,
      null,
    ]

    const hostileMarkdown = [
      '# Titel mit Umlauten äöü und Emoji 🏗️',
      '',
      'Siehe **[3]** und **[12]** sowie einen Link https://example.test/a?b=1&c=2.',
      '',
      '| A | B |',
      '|---|---|',
      '|  | leer |',
      '| x |  |',
      '',
      '> Zitat mit **fett** und `code`.',
      '',
      '- Liste',
      '  - verschachtelt',
      '',
      '```mermaid',
      'flowchart TD',
      '```',
      '',
    ].join('\n')

    it('renders unknown card shapes with non-string leaves', async () => {
      const bytes = await renderMarkdownPdf(REPORT, { ...BASE, cards: hostileCards })

      expect(magic(bytes)).toBe('%PDF-')
    })

    it('renders markdown at the ragged edge of the block parser', async () => {
      const bytes = await renderMarkdownPdf(hostileMarkdown, BASE)

      expect(magic(bytes)).toBe('%PDF-')
    })

    it('renders both hostilities at once', async () => {
      const bytes = await renderMarkdownPdf(hostileMarkdown, { ...BASE, cards: hostileCards })

      expect(magic(bytes)).toBe('%PDF-')
    })
  })
})
