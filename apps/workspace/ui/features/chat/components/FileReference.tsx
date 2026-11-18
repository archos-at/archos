'use client'

import { createContext, useContext, type FC, type ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { motion, springPress } from '@/components/motion'
import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import { useHoverPopover } from '@/hooks/use-hover-popover'
import { fileTypeIcon, isCitable } from '@/features/documents/components/document-status'
import type { StoredFile } from '@/features/documents/hooks/use-surfaced-documents'
import { fileNameFromHref } from '../lib/file-references'
import { useOpenStoredFile } from '../hooks/use-open-stored-file'
import { FileReferencePeek } from './FileReferencePeek'

export type FileReferenceResolver = (fileName: string) => StoredFile | null

const FileReferenceContext = createContext<FileReferenceResolver | null>(null)

export const FileReferenceProvider: FC<{
  resolve: FileReferenceResolver
  children: ReactNode
}> = ({ resolve, children }) => (
  <FileReferenceContext.Provider value={resolve}>{children}</FileReferenceContext.Provider>
)

export const useFileReferenceResolver = (): FileReferenceResolver | null =>
  useContext(FileReferenceContext)

export const FileReferenceLink: FC<{
  href: string
  children: ReactNode
  fallback: ReactNode
}> = ({ href, children, fallback }) => {
  const resolve = useFileReferenceResolver()
  const fileName = fileNameFromHref(href)
  const resolved = resolve && fileName ? resolve(fileName) : null
  if (!resolved) return <>{fallback}</>
  return (
    <FileReferenceChip stored={resolved} label={children} fileName={fileName ?? resolved.file.filename} />
  )
}

const FILE_REFERENCE_CLASS = cn(
  'inline rounded-control [box-decoration-break:clone]',
  'text-start',
  'px-[3px] -mx-[3px] py-px',
  'underline decoration-dotted decoration-foreground/30 underline-offset-[3px]',
  'hover:decoration-solid hover:decoration-foreground/50 hover:bg-hover',
  'focus-visible:bg-muted',
  'pointer-coarse:py-1',
  'cursor-pointer transition-colors duration-quick ease-out',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
)

export const DraftFileReference: FC<{ href: string; fileName: string; children: ReactNode }> = ({ href, fileName, children }) => (
  <a href={href} download data-testid="draft-file-reference" className={FILE_REFERENCE_CLASS}>
    <FileGlyph contentType={null} fileName={fileName} />
    {children}
  </a>
)

const FileReferenceChip: FC<{
  stored: StoredFile
  fileName: string
  label: ReactNode
}> = ({ stored, fileName, label }) => {
  const t = useTranslations(chatCopy)
  const peek = useHoverPopover()
  const openFile = useOpenStoredFile()
  const askable = isCitable(stored.file)

  return (
    <>
      {/* A press gives way slightly — the kit's vocabulary for anything the
          reader physically touches. Scale only, no vertical move, so a chip
          cannot nudge the line of prose it sits on. */}
      <motion.button
        type="button"
        data-testid="file-reference"
        data-file-reference={stored.file.filename}
        whileTap={{ scale: 0.97 }}
        transition={springPress}
        {...peek.triggerProps}
        onClick={() => {
          peek.dismiss()
          openFile(stored)
        }}
        aria-label={t(askable ? 'fileReference.openAskAria' : 'fileReference.openAria', { name: stored.file.filename })}
        className={FILE_REFERENCE_CLASS}
      >
        <FileGlyph contentType={stored.file.contentType} fileName={stored.file.filename} />
        {label}
      </motion.button>
      {/* Mounted only once engaged, and beside the chip rather than around it
          (`HoverPeekPanel`), so a paragraph naming six files costs nothing
          until one of them is looked at. */}
      <HoverPeekPanel peek={peek} className="w-80 p-3">
        <FileReferencePeek stored={stored} writtenAs={fileName} onOpen={() => {
          peek.dismiss()
          openFile(stored)
        }} />
      </HoverPeekPanel>
    </>
  )
}

const FileGlyph: FC<{ contentType: string | null | undefined; fileName: string }> = ({ contentType, fileName }) => {
  const Icon = fileTypeIcon(contentType, fileName)
  return (
    <Icon
      aria-hidden
      className="mr-[0.2em] inline-block size-[0.95em] shrink-0 align-[-0.12em] text-foreground/40"
      strokeWidth={2}
    />
  )
}
