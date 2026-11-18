export type ExclusionReason = 'backup' | 'old' | 'temp' | 'system'

const SYSTEM_NAMES = new Set([
  '__macosx',
  '$recycle.bin',
  '#recycle',
  '@eadir',
  '.trash',
  '.trashes',
  '.git',
  '.svn',
  'papierkorb',
  'recycle bin',
  'system volume information',
  '.spotlight-v100',
  '.fseventsd',
  '.temporaryitems',
])

const OLD_TOKENS = new Set(['alt', 'old', 'veraltet', 'ueberholt', 'obsolet', 'obsolete', 'superseded'])
const BACKUP_TOKENS = new Set(['backup', 'backups', 'bak', 'bkp', 'sicherung', 'sicherungen', 'datensicherung'])
const TEMP_TOKENS = new Set(['temp', 'tmp', 'temporaer', 'cache'])

const NOT_A_BACKUP = ['absicherung', 'versicherung', 'qualitaetssicherung', 'qualitatssicherung', 'beweissicherung']

const UMLAUTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
]

function fold(name: string): string {
  let folded = name.normalize('NFC').toLocaleLowerCase('de').trim()
  for (const [pattern, replacement] of UMLAUTS) folded = folded.replace(pattern, replacement)
  return folded
}

function tokens(folded: string): string[] {
  return folded.split(/[^a-z0-9]+/).filter(Boolean)
}

function isBackupWord(token: string): boolean {
  if (BACKUP_TOKENS.has(token)) return true
  const compound = token.endsWith('sicherung') || token.endsWith('sicherungen')
  return compound && !NOT_A_BACKUP.some((word) => token.endsWith(word) || token.endsWith(`${word}en`))
}

export function exclusionReason(folderName: string): ExclusionReason | null {
  const folded = fold(folderName)
  if (!folded) return null
  if (SYSTEM_NAMES.has(folded)) return 'system'
  if (folded.startsWith('.') || folded.startsWith('~')) return 'system'
  const words = tokens(folded)
  if (folded.endsWith('.bak') || words.some(isBackupWord)) return 'backup'
  if (words.some((word) => TEMP_TOKENS.has(word))) return 'temp'
  if (words.some((word) => OLD_TOKENS.has(word))) return 'old'
  return null
}
