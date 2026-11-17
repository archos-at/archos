import type { FC, ReactNode } from 'react'

export const AuthorityTag: FC<{ children: ReactNode }> = ({ children }) => (
  <span
    className="shrink-0 rounded-[3px] px-1 text-[9px] font-medium uppercase leading-[1.5] tracking-wide"
    style={{ backgroundColor: 'color-mix(in oklch, currentColor 16%, transparent)' }}
  >
    {children}
  </span>
)
