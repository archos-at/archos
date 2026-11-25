import type { FC } from 'react'

const WORD_CHAR = /[\p{L}\p{N}]/u

const isWordChar = (char: string | undefined): boolean => char !== undefined && WORD_CHAR.test(char)

export const labelNamesAuthority = (label: string, authority: string): boolean => {
  const needle = authority.trim().toLocaleLowerCase('de')
  if (!needle) return false
  const haystack = label.toLocaleLowerCase('de')
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return true
  }
  return false
}

export const AuthorityTag: FC<{ authority: string | undefined | null; label: string }> = ({ authority, label }) =>
  !authority || labelNamesAuthority(label, authority) ? null : (
    <span
      className="shrink-0 rounded-[3px] px-1 text-[9px] font-medium uppercase leading-[1.5] tracking-wide"
      style={{ backgroundColor: 'color-mix(in oklch, currentColor 16%, transparent)' }}
    >
      {authority}
    </span>
  )
