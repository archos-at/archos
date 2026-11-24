const ACOUSTIC_LABEL = /\b(?:R['´’]?\s*w|DnT\s*,?\s*w|D\s*n\s*T|Rw|SRI|Schalld[äa]mm[- ]?Ma[sß]{1,2})\b/i
const NUMBER = /-?\d+(?:[.,]\d+)?/

export function ratedSoundReduction(raw: string | number | boolean | null): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null

  const parse = (token: string): number | null => {
    const value = Number(token.replace(',', '.'))
    return Number.isFinite(value) ? value : null
  }

  const bare = new RegExp(`^${NUMBER.source}$`).exec(text)
  if (bare) return parse(bare[0])

  const labelled = ACOUSTIC_LABEL.exec(text)
  if (labelled) {
    const after = new RegExp(NUMBER.source).exec(text.slice(labelled.index + labelled[0].length))
    if (after) return parse(after[0])
  }

  const withUnit = new RegExp(`(${NUMBER.source})\\s*dB\\b`, 'i').exec(text)
  if (withUnit) return parse(withUnit[1])

  return null
}
