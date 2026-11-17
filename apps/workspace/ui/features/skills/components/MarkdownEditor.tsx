'use client'

import { useMemo, type FC, type ReactElement } from 'react'
import MDEditor, { commands, type ICommand } from '@uiw/react-md-editor'
import '@uiw/react-md-editor/markdown-editor.css'
import './markdown-editor.css'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { cn } from '@/lib/utils'

export interface MarkdownEditorProps {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  height?: number
  invalid?: boolean
  className?: string
  labels: MarkdownEditorLabels
}

export interface MarkdownEditorLabels {
  h1: string
  h2: string
  h3: string
  bold: string
  italic: string
  code: string
  codeBlock: string
  bulletList: string
  numberedList: string
  taskList: string
  link: string
  quote: string
  table: string
  edit: string
  split: string
  preview: string
  fullscreen: string
}

function headingCommand(base: ICommand, glyph: string, label: string): ICommand {
  return {
    ...base,
    icon: (
      <span className="text-xs font-medium leading-none">{glyph}</span>
    ),
    buttonProps: { 'aria-label': label, title: label },
  }
}

function relabel(base: ICommand, label: string): ICommand {
  return { ...base, buttonProps: { 'aria-label': label, title: label } }
}

export const MarkdownEditor: FC<MarkdownEditorProps> = ({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  height = 360,
  invalid = false,
  className,
  labels,
}) => {
  const toolbar = useMemo<ICommand[]>(
    () => [
      headingCommand(commands.heading1, 'H1', labels.h1),
      headingCommand(commands.heading2, 'H2', labels.h2),
      headingCommand(commands.heading3, 'H3', labels.h3),
      commands.divider,
      relabel(commands.bold, labels.bold),
      relabel(commands.italic, labels.italic),
      relabel(commands.code, labels.code),
      relabel(commands.codeBlock, labels.codeBlock),
      commands.divider,
      relabel(commands.unorderedListCommand, labels.bulletList),
      relabel(commands.orderedListCommand, labels.numberedList),
      relabel(commands.checkedListCommand, labels.taskList),
      commands.divider,
      relabel(commands.link, labels.link),
      relabel(commands.quote, labels.quote),
      relabel(commands.table, labels.table),
    ],
    [labels],
  )

  const viewCommands = useMemo<ICommand[]>(
    () => [
      relabel(commands.codeEdit, labels.edit),
      relabel(commands.codeLive, labels.split),
      relabel(commands.codePreview, labels.preview),
      commands.divider,
      relabel(commands.fullscreen, labels.fullscreen),
    ],
    [labels],
  )

  return (
    <MDEditor
      value={value}
      onChange={(next) => onChange(next ?? '')}
      height={height}
      minHeight={200}
      maxHeight={760}
      preview="edit"
      className={cn('markdown-editor', className)}
      aria-invalid={invalid || undefined}
      commands={toolbar}
      extraCommands={viewCommands}
      textareaProps={{
        id,
        placeholder,
        onBlur,
        spellCheck: true,
      }}
      components={{
        preview: (source): ReactElement => (
          <MarkdownRenderer content={source} className="text-sm" compact />
        ),
      }}
    />
  )
}
