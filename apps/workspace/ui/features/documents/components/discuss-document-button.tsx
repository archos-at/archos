'use client'

import type { JSX } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FileItem } from './project-file-workspace'
import { askAboutFile } from '../lib/ask-about-file'
import { documentQuestionHref } from '../lib/document-question'

export interface DiscussDocumentButtonProps {
  projectId: string
  documentId: string
  filename?: string | null
  file?: FileItem
  hint?: string
  variant?: 'default' | 'secondary' | 'ghost'
  size?: 'sm' | 'default'
  withIcon?: boolean
  iconOnly?: boolean
  onNavigate?: () => void
  className?: string
}

export function DiscussDocumentButton({
  projectId,
  documentId,
  filename,
  file,
  hint,
  variant = 'default',
  size = 'sm',
  withIcon = false,
  iconOnly = false,
  onNavigate,
  className,
}: DiscussDocumentButtonProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const router = useRouter()

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn('h-8', iconOnly && 'w-8 px-0', className)}
      title={hint ?? (iconOnly ? t('assignment.discuss') : undefined)}
      data-testid="discuss-document"
      onClick={() => {
        onNavigate?.()
        const navigate = (href: string): void => router.push(href)
        if (file) {
          askAboutFile({ projectId, file, navigate })
          return
        }
        navigate(
          documentQuestionHref(projectId, documentId, filename ? { filename } : {}),
        )
      }}
    >
      {/* Sparkles is the agent's glyph across the rail (the read-by label), so
          the button that talks to the agent carries it too. */}
      {(withIcon || iconOnly) && <Sparkles className="size-3.5" aria-hidden />}
      {iconOnly ? <span className="sr-only">{t('assignment.discuss')}</span> : t('assignment.discuss')}
    </Button>
  )
}
