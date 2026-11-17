'use client'

import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import { searchReturnPath, type HitReturn } from '../lib/search-hrefs'

const SearchReturnContext = createContext<HitReturn>({})

export function SearchReturnProvider({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname() ?? ''
  const query = useSearchParams()?.toString() ?? ''
  const value = useMemo<HitReturn>(() => ({ back: pathname ? searchReturnPath(pathname, query) : null }), [pathname, query])
  return <SearchReturnContext.Provider value={value}>{children}</SearchReturnContext.Provider>
}

export function useSearchReturn(): HitReturn {
  return useContext(SearchReturnContext)
}
