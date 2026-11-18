const NO_BREAK_SPACE = '\u00A0'

const UNITS = ['m²', 'm³', 'cm', 'mm', 'km', 'kg', 'kN', 'kW', 'dB', '°C', 'm', 't', '%', '‰', '°']

const FIGURE_AND_UNIT = new RegExp(`(\\d) (?=(?:${UNITS.join('|')})(?![\\p{L}\\p{N}]))`, 'gu')

export function keepUnitsTogether(text: string): string {
  return text.replace(FIGURE_AND_UNIT, `$1${NO_BREAK_SPACE}`)
}
