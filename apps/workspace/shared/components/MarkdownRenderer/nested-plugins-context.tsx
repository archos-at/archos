'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { PluggableList } from 'unified'

const NestedMarkdownPluginsContext = createContext<PluggableList | undefined>(undefined)

export const NestedMarkdownPluginsProvider = ({
  plugins,
  children,
}: {
  plugins: PluggableList
  children: ReactNode
}) => <NestedMarkdownPluginsContext.Provider value={plugins}>{children}</NestedMarkdownPluginsContext.Provider>

export const useNestedMarkdownPlugins = (): PluggableList | undefined => useContext(NestedMarkdownPluginsContext)
