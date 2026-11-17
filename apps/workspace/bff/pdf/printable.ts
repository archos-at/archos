const WIN_ANSI_HIGH = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

const isPrintable = (character: string): boolean => {
  const code = character.codePointAt(0)
  if (code === undefined) return false
  if (code === 0x09 || code === 0x0a) return true
  if (code >= 0x20 && code <= 0x7e) return true
  if (code >= 0xa0 && code <= 0xff) return true
  return WIN_ANSI_HIGH.has(character)
}

const SUBSTITUTIONS: Record<string, string> = {
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '≈': '~',
  '≙': '=',
  '≡': '=',
  '−': '-',
  '⁄': '/',
  '∕': '/',
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '⇒': '=>',
  '⇐': '<=',
  '↑': '^',
  '↓': 'v',
  '⌀': 'Ø',
  '∅': 'Ø',
  'Δ': 'Delta',
  '∆': 'Delta',
  'δ': 'delta',
  'λ': 'lambda',
  'ρ': 'rho',
  'σ': 'sigma',
  'α': 'alpha',
  'β': 'beta',
  'γ': 'gamma',
  'ε': 'epsilon',
  'η': 'eta',
  'θ': 'theta',
  'π': 'pi',
  'φ': 'phi',
  'ψ': 'psi',
  'ω': 'omega',
  'Σ': 'Sigma',
  'Ω': 'Ohm',
  'μ': 'µ',
  '∞': 'inf',
  '√': 'sqrt',
  '∑': 'Sigma',
  '✓': '+',
  '✔': '+',
  '✗': 'x',
  '✘': 'x',
  '☑': '[x]',
  '☐': '[ ]',
  '\u2007': ' ',
  '\u2008': ' ',
  '\u2009': ' ',
  '\u200A': ' ',
  '\u202F': ' ',
  '\u200B': '',
  '\u200C': '',
  '\u200D': '',
  '\uFEFF': '',
  '‑': '-',
  '‒': '-',
  '―': '-',
}

const decompose = (character: string): string => {
  const stripped = character
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  const kept = Array.from(stripped).filter(isPrintable).join('')
  return kept || '?'
}

// eslint-disable-next-line no-control-regex
const ALL_PRINTABLE = /^[\t\n -~\u00A0-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/

export function printable(text: string): string {
  if (ALL_PRINTABLE.test(text)) return text
  return Array.from(text)
    .map((character) =>
      isPrintable(character) ? character : (SUBSTITUTIONS[character] ?? decompose(character))
    )
    .join('')
}
