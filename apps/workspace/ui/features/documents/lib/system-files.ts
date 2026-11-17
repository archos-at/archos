const EXACT_NAMES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', 'icon\r'])

export function isSystemFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (EXACT_NAMES.has(lower)) return true
  if (name.startsWith('._')) return true
  if (name.startsWith('~$')) return true
  if (name.startsWith('.~lock.') && name.endsWith('#')) return true
  return false
}
