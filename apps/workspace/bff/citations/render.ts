import 'server-only'

export type RenderableCitationFormat = 'apa' | 'bibtex' | 'ris'

let citePromise: Promise<typeof import('@citation-js/core').Cite> | null = null

const loadCite = async (): Promise<typeof import('@citation-js/core').Cite> => {
  if (!citePromise) {
    citePromise = (async () => {
      const [{ Cite }] = await Promise.all([
        import('@citation-js/core'),
        import('@citation-js/plugin-csl'),
        import('@citation-js/plugin-bibtex'),
        import('@citation-js/plugin-ris'),
      ])
      return Cite
    })()
  }
  return citePromise
}

export const renderCitations = async (
  items: unknown[],
  format: RenderableCitationFormat
): Promise<string> => {
  if (items.length === 0) return ''
  const Cite = await loadCite()
  const cite = new Cite(items)
  if (format === 'bibtex') return String(cite.format('bibtex')).trim()
  if (format === 'ris') return String(cite.format('ris')).trim()
  return String(
    cite.format('bibliography', { format: 'text', template: 'apa', lang: 'de-DE' })
  ).trim()
}
