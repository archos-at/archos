import type { FC } from 'react'

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const labelNamesAuthority = (label: string, authority: string): boolean =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(authority.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(label)

export const AuthorityTag: FC<{ authority: string | undefined | null; label: string }> = ({ authority, label }) =>
  !authority || labelNamesAuthority(label, authority) ? null : (
    <span
      className="shrink-0 rounded-[3px] px-1 text-[9px] font-medium uppercase leading-[1.5] tracking-wide"
      style={{ backgroundColor: 'color-mix(in oklch, currentColor 16%, transparent)' }}
    >
      {authority}
    </span>
  )
