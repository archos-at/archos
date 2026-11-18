export const LEGACY_BIM_RULE_IDS: Readonly<Record<string, string>> = {
  'oib4-treppe-steigungsverhaeltnis': 'oib4-stair-rise-run-ratio',
  'oib4-tuer-durchgangsbreite': 'oib4-door-clear-width',
  'oib3-raumhoehe': 'oib3-room-height',
  'oib2-feuerwiderstand-tragend': 'oib2-fire-resistance-load-bearing',
  'oib6-u-wert-aussenwand': 'oib6-u-value-external-wall',
  'oib6-u-wert-fenster': 'oib6-u-value-window',
  'oib5-schalldaemmung-deklariert': 'oib5-sound-insulation-declared',
}

export const canonicalBimRuleId = (ruleId: string): string => LEGACY_BIM_RULE_IDS[ruleId] ?? ruleId
