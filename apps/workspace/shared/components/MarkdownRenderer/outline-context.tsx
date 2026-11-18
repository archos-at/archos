'use client'

import { createContext, useContext } from 'react'

const OutlineContext = createContext<(() => void) | null>(null)

export const OutlineProvider = OutlineContext.Provider

export const useOpenOutline = (): (() => void) | null => useContext(OutlineContext)
