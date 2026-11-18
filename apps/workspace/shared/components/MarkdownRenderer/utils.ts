import type { ReactNode } from 'react'
import { transliterateGerman } from '@/lib/text/latinize'
import type { SupportedLanguage } from './types'

const LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  ts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'python',
  python: 'python',
  json: 'json',
  bash: 'bash',
  sh: 'shell',
  shell: 'shell',
  html: 'html',
  css: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  rs: 'rust',
}

export const getLanguageFromClassName = (className?: string): SupportedLanguage => {
  if (!className) return 'bash' // Default fallback for unlabeled code blocks

  const match = className.match(/language-(\w+)/)
  if (!match) return 'bash'

  const lang = match[1].toLowerCase()
  return LANGUAGE_MAP[lang] || 'bash'
}

const MERMAID_OPENERS =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|sankey-beta|xychart-beta|block-beta|C4Context)\b/

const MERMAID_PREAMBLE = /^%%/

export const isMermaidFence = (className?: string, source?: string): boolean => {
  if (/(?:^|\s)language-mermaid(?:$|\s)/.test(className ?? '')) return true

  const firstLine = (source ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !MERMAID_PREAMBLE.test(line))
  return firstLine !== undefined && MERMAID_OPENERS.test(firstLine)
}

export const headingAnchorId = (text: string): string =>
  transliterateGerman(text.toLowerCase())
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function getTextFromChildren(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getTextFromChildren).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return getTextFromChildren((node as React.ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}
