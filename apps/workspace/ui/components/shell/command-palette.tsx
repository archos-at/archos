'use client'

import * as React from 'react'
import { defaultFilter } from 'cmdk'
import { useRouter } from 'next/navigation'

import { CommandDialog, CommandInput, CommandList } from '@/components/ui/command'
import { DialogClose } from '@/components/ui/dialog'
import { useHeightGlide } from '@/components/motion/height-glide'
import {
  PALETTE_ALL_RESULTS_VALUE,
  PALETTE_LATE_ANSWER_MS,
  PALETTE_LATE_HOLD_MS,
  PALETTE_RETRY_VALUE,
  PaletteKinds,
  PaletteRecentOpened,
  PaletteSearchResults,
  paletteFilter,
  paletteHitHref,
  paletteHits,
  paletteHitValue,
  paletteKindQuery,
  isPaletteHitValue,
  searchPageHref,
  usePaletteSearch,
  useRecentOpened,
  type PaletteKind,
} from '@/features/search'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import { commonCopy } from '@/i18n/namespaces/common'
import { searchCopy } from '@/i18n/namespaces/search'
import { shortcutsCopy } from '@/i18n/namespaces/shortcuts'
import { ShortcutKeys } from './shortcut-keys'
import { MOD } from './shortcuts'

export function projectIdFromPathname(pathname: string): string | null {
  const match = /^\/app\/projects\/([^/]+)/.exec(pathname)
  return match ? match[1] : null
}

const PALETTE_ITEM_CLASS = 'pointer-coarse:min-h-11 pointer-coarse:text-[15px]'

const DESKTOP_PALETTE_CLASS = 'md:top-[15%] md:max-w-2xl!'

const PHONE_PALETTE_CLASS = [
  'max-md:inset-x-0! max-md:top-0! max-md:bottom-auto! max-md:left-0! max-md:translate-x-0! max-md:translate-y-0!',
  'max-md:h-[var(--visual-viewport-height,100dvh)]! max-md:max-h-none! max-md:w-full! max-md:max-w-none!',
  'max-md:flex! max-md:flex-col max-md:rounded-none! max-md:border-0! max-md:pt-[env(safe-area-inset-top)]',
  'max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100',
].join(' ')

const OFFICE = {}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()
  const t = useTranslations(shortcutsCopy, 'palette')
  const tSearch = useTranslations(searchCopy)
  const tCommon = useTranslations(commonCopy)

  const [query, setQuery] = React.useState('')
  const [kind, setKind] = React.useState<PaletteKind>('all')
  React.useEffect(() => {
    if (open) return
    setQuery('')
    setKind('all')
  }, [open])
  const words = query.trim()

  const asked = React.useMemo(() => paletteKindQuery(kind), [kind])
  const search = usePaletteSearch(query, OFFICE, open, asked)
  const recent = useRecentOpened(open)

  const [selected, setSelected] = React.useState('')
  const movedByReader = React.useRef(false)
  React.useEffect(() => {
    movedByReader.current = false
  }, [words])
  const answerHits = React.useMemo(
    () => (search.answered === words && search.response ? paletteHits(search.response, asked.limit).map(paletteHitValue) : []),
    [search.answered, search.response, words, asked.limit],
  )
  const firstHit = answerHits[0] ?? null
  React.useEffect(() => {
    if (!firstHit) return
    setSelected((current) =>
      current === '' ||
      current === PALETTE_ALL_RESULTS_VALUE ||
      (isPaletteHitValue(current) && !(movedByReader.current && answerHits.includes(current)))
        ? firstHit
        : current,
    )
  }, [firstHit, answerHits])
  React.useEffect(() => {
    if (search.failed) setSelected(PALETTE_RETRY_VALUE)
  }, [search.failed])
  const filter = React.useMemo(() => paletteFilter(defaultFilter), [])
  const answeredEmpty = words !== '' && (search.failed || (search.answered === words && search.response !== null && firstHit === null))

  const { opening, response } = search
  const { remember } = recent
  const openSearchHref = React.useCallback(
    (href: string) => {
      remember(response, href)
      opening(href)
      onOpenChange(false)
      router.push(href)
    },
    [remember, response, opening, onOpenChange, router],
  )
  const allHref = words ? searchPageHref(words) : null
  const awaitingAnswer = words !== '' && !search.failed && (search.loading || search.answered !== words)
  const [heldEnter, setHeldEnter] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (heldEnter === null) return
    if (heldEnter !== words || search.failed) {
      setHeldEnter(null)
      return
    }
    if (awaitingAnswer) return
    setHeldEnter(null)
    openSearchHref(firstHit ? paletteHitHref(firstHit) : searchPageHref(words))
  }, [heldEnter, words, search.failed, awaitingAnswer, firstHit, openSearchHref])
  const onFieldKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        movedByReader.current = true
        setHeldEnter(null)
      }
      if (event.key !== 'Enter') return
      const chord = event.metaKey || event.ctrlKey
      if (chord && allHref) {
        event.preventDefault()
        openSearchHref(allHref)
        return
      }
      if (!chord && awaitingAnswer && !movedByReader.current && (selected === PALETTE_ALL_RESULTS_VALUE || isPaletteHitValue(selected))) {
        event.preventDefault()
        setHeldEnter(words)
      }
    },
    [allHref, openSearchHref, awaitingAnswer, selected, words],
  )
  const finePointer = useMediaQuery('(pointer: fine)')

  const searching = useDelayedFlag(
    words !== '' && !search.failed && search.response !== null && (search.loading || search.answered !== words),
    PALETTE_LATE_ANSWER_MS,
    PALETTE_LATE_HOLD_MS
  )

  const desktop = !useIsMobile()
  const [listElement, setListElement] = React.useState<HTMLDivElement | null>(null)
  const listRef = React.useMemo(() => ({ current: listElement }), [listElement])
  const awaitingFirst = desktop && open && words !== '' && !search.failed && search.response === null
  const floor = React.useRef(0)
  React.useLayoutEffect(() => {
    if (!listElement) return
    if (!awaitingFirst) {
      floor.current = 0
      if (listElement.firstElementChild instanceof HTMLElement) listElement.firstElementChild.style.minHeight = ''
      return
    }
    const sizer = listElement.firstElementChild
    if (!(sizer instanceof HTMLElement) || listElement.style.height !== '') return
    const { paddingTop, paddingBottom } = getComputedStyle(listElement)
    const visible = listElement.clientHeight - parseFloat(paddingTop) - parseFloat(paddingBottom)
    floor.current = Math.min(Math.max(floor.current, sizer.offsetHeight), visible)
    sizer.style.minHeight = `${floor.current}px`
  })
  const [overflows, setOverflows] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!listElement || typeof ResizeObserver === 'undefined') return
    const measure = () => setOverflows(listElement.scrollHeight > listElement.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(listElement)
    if (listElement.firstElementChild) observer.observe(listElement.firstElementChild)
    measure()
    return () => observer.disconnect()
  }, [listElement])
  useHeightGlide(listRef, desktop && open ? `${search.answered}|${search.loading}` : null)

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('description')}
      showHints={finePointer}
      className={`motion-reduce:animate-none ${DESKTOP_PALETTE_CLASS} ${PHONE_PALETTE_CLASS}`}
      commandProps={{ filter, value: selected, onValueChange: setSelected }}
      hintLabels={{
        move: t('hints.move'),
        open: t('hints.open'),
        close: t('hints.close'),
      }}
      hintsTrailing={
        words && !answeredEmpty ? (
          <>
            <ShortcutKeys segments={[{ kind: 'chord', caps: [MOD, '↵'] }]} />
            {t('hints.all')}
          </>
        ) : null
      }
    >
      <div className="shrink-0 border-b">
        <div className="flex items-center [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:border-b-0 max-md:[&_[data-slot=command-input-wrapper]]:h-14 max-md:[&_[data-slot=command-input-wrapper]]:bg-transparent!">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            onKeyDown={onFieldKeyDown}
            busy={searching || heldEnter !== null}
            placeholder={t('placeholder')}
            className="pointer-coarse:text-base outline-none!"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <DialogClose className="text-foreground hover:bg-hover focus-visible:ring-ring/60 mr-1 flex h-11 shrink-0 items-center rounded-control px-3 text-[15px] font-medium outline-none transition-colors duration-quick ease-out focus-visible:ring-2 motion-reduce:transition-none md:hidden">
            {tCommon('actions.cancel')}
          </DialogClose>
        </div>
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <PaletteKinds value={kind} onChange={setKind} />
          <span className="text-muted-foreground shrink-0 pr-1 text-xs" data-testid="palette-scope">
            {tSearch('palette.scope.office')}
          </span>
        </div>
      </div>
      <CommandList
        ref={setListElement}
        className={cn(overflows && 'md:scroll-fade-bottom md:[--scroll-fade-size:44px]', awaitingFirst && '[&_[cmdk-list-sizer]]:flex [&_[cmdk-list-sizer]]:flex-col', 'min-h-0 md:max-h-[min(60dvh,32rem)] max-md:max-h-none max-md:flex-1 max-md:overscroll-contain')}>
        {words ? (
          <PaletteSearchResults
            text={query}
            answered={search.answered}
            response={search.response}
            loading={search.loading}
            failed={search.failed}
            onOpen={openSearchHref}
            onRetry={search.retry}
            allHref={allHref ?? searchPageHref(words)}
            perKind={asked.limit}
            itemClassName={PALETTE_ITEM_CLASS}
          />
        ) : (
          <PaletteRecentOpened entries={recent.entries} onOpen={openSearchHref} itemClassName={PALETTE_ITEM_CLASS} />
        )}
      </CommandList>
    </CommandDialog>
  )
}
