export interface DocRun {
  text: string
  bold?: boolean
  italic?: boolean
  mono?: boolean
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5

export type DocBlock =
  | { kind: 'heading'; level: HeadingLevel; text: string }
  | { kind: 'paragraph'; runs: DocRun[]; style?: 'body' | 'meta' | 'quote' }
  | { kind: 'bullets'; items: DocRun[][] }
  | { kind: 'table'; head?: string[]; rows: DocRun[][][] }
  | { kind: 'rule' }

export const paragraph = (text: string, style?: 'body' | 'meta' | 'quote'): DocBlock => ({
  kind: 'paragraph',
  runs: [{ text }],
  style,
})

export const labelled = (label: string, value: string): DocBlock => ({
  kind: 'paragraph',
  runs: [{ text: `${label}: `, bold: true }, { text: value }],
  style: 'meta',
})

export const cell = (text: string): DocRun[] => [{ text }]

export const compact = (blocks: (DocBlock | null | undefined)[]): DocBlock[] =>
  blocks.filter((block): block is DocBlock => {
    if (!block) return false
    if (block.kind === 'rule') return true
    if (block.kind === 'bullets') return block.items.length > 0
    if (block.kind === 'table') return block.rows.length > 0
    if (block.kind === 'paragraph') return block.runs.some((run) => run.text.trim().length > 0)
    return block.text.trim().length > 0
  })
