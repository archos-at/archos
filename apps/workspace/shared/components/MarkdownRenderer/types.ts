import type { ReactNode } from 'react'
import type { PluggableList } from 'unified'

export interface MarkdownRendererProps {
  content: string
  isStreaming?: boolean
  className?: string
  compact?: boolean
  caret?: ReactNode
  remarkPlugins?: PluggableList
}

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'python'
  | 'json'
  | 'bash'
  | 'shell'
  | 'html'
  | 'css'
  | 'yaml'
  | 'markdown'
  | 'go'
  | 'rust'
