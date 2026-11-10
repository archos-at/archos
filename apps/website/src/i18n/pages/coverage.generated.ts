/**
 * The building-law page's country lines, generated from the coverage the country packs state
 * (configs/knowledge-packs/, ADR-0173) by scripts/check_coverage_copy.py --write. Do not edit:
 * the check fails copy that claims a country's law before its pack states a coverage.
 */

export const coverageCopy = {
  de: {
    itemKey: 'Deutschland und Schweiz',
    itemValue: 'Die Rechtstexte noch nicht. Pläne, Modelle, Unterlagen und Bürowissen nutzt {name} unabhängig vom Land.',
    faqQ: 'Gilt das auch für Projekte in Deutschland oder der Schweiz?',
    faqA: 'Die Rechtstexte decken heute Österreich ab. Projektunterlagen, Pläne, Modelle und Bürowissen nutzt {name} in jedem Land.',
  },
  en: {
    itemKey: 'Germany and Switzerland',
    itemValue: 'Not the legal texts yet. {name} works with plans, models, documents and office knowledge in any country.',
    faqQ: 'Does this work for projects in Germany or Switzerland?',
    faqA: 'The legal texts cover Austria today. {name} works with project documents, plans, models and office knowledge in any country.',
  },
}
