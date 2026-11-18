function fireResistanceMinutes(raw: string): number | null {
  const match = /(\d{2,3})/.exec(raw)
  if (!match) return null
  const minutes = Number(match[1])
  return Number.isFinite(minutes) ? minutes : null
}

const EURO_CRITERIA = new Set(['R', 'E', 'I', 'M', 'W', 'S', 'C'])

export function compareFireRating(declared: string, required: string): 'meets' | 'short' | 'unreadable' {
  if (/[/|]|\bund\b|\band\b/i.test(declared)) return 'unreadable'

  const declaredMinutes = fireResistanceMinutes(declared)
  const requiredMinutes = fireResistanceMinutes(required)
  if (declaredMinutes === null || requiredMinutes === null) return 'unreadable'

  const requiredLetters = /^[A-Za-z]+/.exec(required.trim())?.[0]?.toUpperCase() ?? ''
  const declaredLetters = /^[A-Za-z]+/.exec(declared.trim())?.[0]?.toUpperCase() ?? ''
  if (declaredLetters === '' || [...declaredLetters].some((letter) => !EURO_CRITERIA.has(letter))) {
    return 'unreadable'
  }
  const coversCriteria = [...requiredLetters].every((letter) => declaredLetters.includes(letter))
  return declaredMinutes >= requiredMinutes && coversCriteria ? 'meets' : 'short'
}

export const FIRE_RESISTANCE_R_MINUTES: Record<'top' | 'above' | 'below', Record<number, number | null>> = {
  top: { 1: null, 2: 30, 3: 30, 4: 30, 5: 60 },
  above: { 1: 30, 2: 30, 3: 60, 4: 60, 5: 90 },
  below: { 1: 60, 2: 60, 3: 90, 4: 90, 5: 90 },
}
