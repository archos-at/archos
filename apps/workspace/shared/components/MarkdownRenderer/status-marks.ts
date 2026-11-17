export type StatusTone = 'success' | 'destructive' | 'warning' | 'info' | 'muted'

type StatusRole = 'holds' | 'open'

const STATUS_WORDS: ReadonlyArray<readonly [word: string, tone: StatusTone, role?: StatusRole]> = [
  ['erfüllt', 'success'],
  ['erfuellt', 'success'],
  ['met', 'success'],
  ['compliant', 'success'],
  ['vorhanden', 'success'],
  ['present', 'success'],
  ['zulässig', 'success'],
  ['permitted', 'success'],
  ['erledigt', 'success'],
  ['done', 'success'],
  ['trifft zu', 'success', 'holds'],
  ['applies', 'success', 'holds'],
  ['aktuell', 'success', 'holds'],
  ['current', 'success', 'holds'],
  ['nicht erfüllt', 'destructive'],
  ['nicht erfuellt', 'destructive'],
  ['not met', 'destructive'],
  ['non-compliant', 'destructive'],
  ['unzulässig', 'destructive'],
  ['not permitted', 'destructive'],
  ['fehlt', 'destructive', 'open'],
  ['missing', 'destructive', 'open'],
  ['teilweise', 'warning'],
  ['partial', 'warning'],
  ['offen', 'warning', 'open'],
  ['open', 'warning', 'open'],
  ['zu prüfen', 'warning', 'open'],
  ['prüfen', 'warning', 'open'],
  ['to check', 'warning', 'open'],
  ['unklar', 'warning', 'open'],
  ['unclear', 'warning', 'open'],
  ['bedingt', 'info'],
  ['conditional', 'info'],
  ['erforderlich', 'muted'],
  ['required', 'muted'],
  ['nicht anwendbar', 'muted'],
  ['not applicable', 'muted'],
  ['n/a', 'muted'],
  ['trifft nicht zu', 'muted'],
  ['does not apply', 'muted'],
  ['ausstehend', 'muted'],
  ['pending', 'muted'],
]

const normal = (cellText: string) => cellText.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')

const BY_WORD: ReadonlyMap<string, { tone: StatusTone; role?: StatusRole }> = new Map(
  STATUS_WORDS.map(([word, tone, role]) => [word, { tone, role }] as const)
)

export function statusTone(cellText: string): StatusTone | null {
  return BY_WORD.get(normal(cellText))?.tone ?? null
}

export const isActiveStatus = (cellText: string): boolean => BY_WORD.get(normal(cellText))?.role === 'holds'

export const isOpenStatus = (cellText: string): boolean => BY_WORD.get(normal(cellText))?.role === 'open'

const TONE_NAMES: ReadonlySet<string> = new Set(STATUS_WORDS.map(([, tone]) => tone))

export function isStatusTone(value: unknown): value is StatusTone {
  return typeof value === 'string' && TONE_NAMES.has(value)
}

const BY_LENGTH: readonly string[] = [...BY_WORD.keys()].sort((a, b) => b.length - a.length)

export function trailingStatus(sentence: string): { word: string; tone: StatusTone } | null {
  const text = normal(sentence.replace(/\[\d+\]/g, '')).replace(/[\s.!…;:,)\]]+$/, '')
  for (const word of BY_LENGTH) {
    if (text === word || text.endsWith(` ${word}`)) {
      const entry = BY_WORD.get(word)
      if (entry) return { word, tone: entry.tone }
    }
  }
  return null
}
