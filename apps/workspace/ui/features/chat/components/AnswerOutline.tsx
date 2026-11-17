'use client'

import { type FC, type ReactNode, type RefObject, useMemo, useState } from 'react'
import { ChevronRight, TableOfContents } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PRESSABLE } from '@/components/ui/press'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { markdownHeadings, type MarkdownHeading } from '@/shared/components/MarkdownRenderer/headings'
import { OutlineProvider } from '@/shared/components/MarkdownRenderer/outline-context'

export const MIN_SECTIONS = 4

export const outlineHeadings = (markdown: string): MarkdownHeading[] => {
  const headings = markdownHeadings(markdown).filter((heading) => heading.level === 2 || heading.level === 3)
  const sections = headings.filter((heading) => heading.level === 2).length
  return sections >= MIN_SECTIONS ? headings : []
}

const headingElement = (scope: HTMLElement | null, id: string): HTMLElement | null =>
  Array.from(scope?.querySelectorAll<HTMLElement>('h2, h3') ?? []).find((element) => element.id === id) ?? null

export const AnswerOutline: FC<{
  markdown: string
  scopeRef: RefObject<HTMLElement | null>
  enabled: boolean
  children: ReactNode
}> = ({ markdown, scopeRef, enabled, children }) => {
  const t = useTranslations(chatCopy)
  const [open, setOpen] = useState(false)
  const headings = useMemo(() => (enabled ? outlineHeadings(markdown) : []), [enabled, markdown])
  const offered = headings.length > 0

  const sections = headings.filter((heading) => heading.level === 2).length
  const jump = (id: string): void => {
    setOpen(false)
    window.requestAnimationFrame(() => {
      const target = headingElement(scopeRef.current, id)
      if (!target) return
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      target.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
    })
  }

  return (
    <OutlineProvider value={offered ? () => setOpen(true) : null}>
      {offered && (
      <button data-attr="outline-entry"
        type="button"
        onClick={() => setOpen(true)}
        data-testid="outline-entry"
        className={cn(
          'text-muted-foreground hover:text-foreground bg-muted/50 hidden min-h-11 w-full items-center gap-2 rounded-control px-3 text-left text-sm font-medium outline-none pointer-coarse:flex print:hidden',
          PRESSABLE,
          FOCUS_RING
        )}
      >
        <TableOfContents className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">{t('outline.label')}</span>
        <span className="text-xs font-normal tabular-nums">{t('outline.count', { count: sections })}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </button>
      )}
      {children}
      {offered && (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          closeLabel={t('outline.close')}
          data-testid="outline-sheet"
          className="max-h-[82dvh] gap-2 rounded-t-2xl px-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5"
        >
          <SheetHeader className="px-5 pr-14">
            <SheetTitle className="text-base">{t('outline.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('outline.description')}</SheetDescription>
          </SheetHeader>
          <ol className="flex flex-col">
            {headings.map((heading) => (
              <li key={heading.id}>
                <button data-attr="chat-jump"
                  type="button"
                  onClick={() => jump(heading.id)}
                  className={cn(
                    'text-foreground hover:bg-hover flex min-h-11 w-full items-center px-5 py-2 text-left outline-none',
                    heading.level === 3 ? 'text-muted-foreground pl-9 text-sm' : 'text-base font-medium',
                    PRESSABLE,
                    FOCUS_RING
                  )}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
      )}
    </OutlineProvider>
  )
}
