'use client'

import * as React from 'react'
import { defaultFilter } from 'cmdk'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, FolderKanban, LogOut, Moon, Plus, Sun, UserRound } from 'lucide-react'

import { useAuth } from '@/adapters/auth/use-auth'
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { DialogClose } from '@/components/ui/dialog'
import { useHeightGlide } from '@/components/motion/height-glide'
import { useLayoutStore } from '@/features/layout/store'
import {
  PALETTE_ALL_RESULTS_VALUE,
  PALETTE_LATE_ANSWER_MS,
  PALETTE_LATE_HOLD_MS,
  PALETTE_RETRY_VALUE,
  paletteHitHref,
  paletteHits,
  PaletteSearchResults,
  PaletteSearchStart,
  captureSavedSearchRun,
  paletteFilter,
  isPaletteHitValue,
  paletteHitValue,
  savedSearchHref,
  searchPageHref,
  usePaletteSearch,
  usePaletteShortcuts,
} from '@/features/search'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import { commonCopy } from '@/i18n/namespaces/common'
import { navCopy } from '@/i18n/namespaces/nav'
import { shortcutsCopy } from '@/i18n/namespaces/shortcuts'
import { paletteSections } from './project-sections'
import { ShortcutKeys } from './shortcut-keys'
import { LEADER_KEY, MOD } from './shortcuts'

interface PaletteProject {
  id: string
  name: string
}

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

function JumpShortcut({ jumpKey }: { jumpKey: string }) {
  return (
    <CommandShortcut className="pointer-coarse:hidden">
      <ShortcutKeys
        segments={[
          { kind: 'chord', caps: [LEADER_KEY.toUpperCase()] },
          { kind: 'then' },
          { kind: 'chord', caps: [jumpKey.toUpperCase()] },
        ]}
      />
    </CommandShortcut>
  )
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  authRequired: boolean
  canViewOrganization: boolean
  showKnowledge?: boolean
  showModels?: boolean
  showSkills?: boolean
  canAccessOfficeShelf?: boolean
  canAccessOfficeStandards?: boolean
}

export function CommandPalette({
  open,
  onOpenChange,
  authRequired,
  canViewOrganization,
  showKnowledge = false,
  showModels = false,
  showSkills = false,
  canAccessOfficeShelf = false,
  canAccessOfficeStandards = false,
}: CommandPaletteProps) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { signOut } = useAuth()
  const theme = useLayoutStore((s) => s.theme)
  const setTheme = useLayoutStore((s) => s.setTheme)
  const t = useTranslations(shortcutsCopy, 'palette')
  const tNav = useTranslations(navCopy)
  const tCommon = useTranslations(commonCopy)

  const [query, setQuery] = React.useState('')
  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  const words = query.trim()

  const projectId = projectIdFromPathname(pathname)
  const scope = React.useMemo(() => (projectId ? { scope: 'project' as const, projectId } : {}), [projectId])
  const search = usePaletteSearch(query, scope, open)
  const shortcuts = usePaletteShortcuts(open)

  const [selected, setSelected] = React.useState('')
  const movedByReader = React.useRef(false)
  React.useEffect(() => {
    movedByReader.current = false
  }, [words])
  const answerHits = React.useMemo(
    () => (search.answered === words && search.response ? paletteHits(search.response).map(paletteHitValue) : []),
    [search.answered, search.response, words],
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

  const { opening } = search
  const openSearchHref = React.useCallback(
    (href: string) => {
      if (words) shortcuts.remember(words)
      opening(href)
      onOpenChange(false)
      router.push(href)
    },
    [words, shortcuts, opening, onOpenChange, router],
  )
  const allHref = words ? searchPageHref(words, projectId) : null
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
    openSearchHref(firstHit ? paletteHitHref(firstHit) : searchPageHref(words, projectId))
  }, [heldEnter, words, search.failed, awaitingAnswer, firstHit, openSearchHref, projectId])
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

  const [projects, setProjects] = React.useState<PaletteProject[] | null>(null)
  React.useEffect(() => {
    if (!open || projects !== null) return
    let cancelled = false
    fetch('/api/projects')
      .then(async (res) => (res.ok ? ((await res.json()) as PaletteProject[]) : []))
      .then((rows) => {
        if (!cancelled) setProjects(rows.map((row) => ({ id: row.id, name: row.name })))
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [open, projects])

  const runCommand = React.useCallback(
    (action: () => void) => {
      onOpenChange(false)
      action()
    },
    [onOpenChange],
  )

  const toggleTheme = React.useCallback(() => {
    const prefersDark =
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
    setTheme(isDark ? 'light' : 'dark')
  }, [theme, setTheme])

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
      <div className="flex shrink-0 items-center md:contents max-md:border-b max-md:[&_[data-slot=command-input-wrapper]]:border-b-0 max-md:[&_[data-slot=command-input-wrapper]]:flex-1 max-md:[&_[data-slot=command-input-wrapper]]:h-14 max-md:[&_[data-slot=command-input-wrapper]]:bg-transparent!">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          onKeyDown={onFieldKeyDown}
          busy={searching || heldEnter !== null}
          placeholder={t('placeholder')}
          className="pointer-coarse:text-base outline-none!"
          enterKeyHint="go"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <DialogClose className="text-foreground hover:bg-hover focus-visible:ring-ring/60 mr-1 flex h-11 shrink-0 items-center rounded-control px-3 text-[15px] font-medium outline-none transition-colors duration-quick ease-out focus-visible:ring-2 motion-reduce:transition-none md:hidden">
          {tCommon('actions.cancel')}
        </DialogClose>
      </div>
      <CommandList
        ref={setListElement}
        className={cn(overflows && 'md:scroll-fade-bottom md:[--scroll-fade-size:44px]', awaitingFirst && '[&_[cmdk-list-sizer]]:flex [&_[cmdk-list-sizer]]:flex-col', 'min-h-0 md:max-h-[min(60dvh,32rem)] max-md:max-h-none max-md:flex-1 max-md:overscroll-contain')}>
        {/* No „Keine Ergebnisse“: a search row always answers, with the way
            to every hit for what was typed. */}
        {words ? (
          <PaletteSearchResults
            text={query}
            answered={search.answered}
            response={search.response}
            loading={search.loading}
            failed={search.failed}
            onOpen={openSearchHref}
            onRetry={search.retry}
            allHref={allHref ?? searchPageHref(words, projectId)}
            scope={scope}
            itemClassName={PALETTE_ITEM_CLASS}
          />
        ) : (
          <PaletteSearchStart
            inProject={projectId !== null}
            recent={shortcuts.recent}
            saved={shortcuts.saved}
            onRecent={setQuery}
            onSaved={(item) => {
              captureSavedSearchRun(item)
              openSearchHref(savedSearchHref(item))
            }}
            onOpenSearch={() => openSearchHref('/app/search')}
            itemClassName={PALETTE_ITEM_CLASS}
          />
        )}
        <CommandSeparator />

        {projects !== null && projects.length > 0 && (
          <CommandGroup heading={t('groups.projects')}>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`project-${project.id} ${project.name}`}
                onSelect={() => runCommand(() => router.push(`/app/projects/${project.id}`))}
                className={PALETTE_ITEM_CLASS}
              >
                <FolderKanban className="text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projectId && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('groups.currentProject')}>
              {paletteSections({ showKnowledge, showSkills, showModels, canAccessOfficeShelf, canAccessOfficeStandards }).map((item) => {
                const Icon = item.icon
                const label = tNav(`sections.${item.i18nKey}`)
                const href =
                  item.href ??
                  (item.segment
                    ? `/app/projects/${projectId}/${item.segment}`
                    : `/app/projects/${projectId}`)
                return (
                  <CommandItem
                    key={item.key}
                    value={`section-${item.key} ${label}`}
                    onSelect={() => runCommand(() => router.push(href))}
                    className={PALETTE_ITEM_CLASS}
                  >
                    <Icon className="text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {item.shortcutKey ? <JumpShortcut jumpKey={item.shortcutKey} /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        {/* A rule between groups, not above the first one: with no project
            list yet it doubled the field's own bottom edge. */}
        {((projects !== null && projects.length > 0) || projectId) && <CommandSeparator />}
        <CommandGroup heading={t('groups.general')}>
          <CommandItem
            value={`new-project ${tNav('projectSwitcher.newProject')}`}
            onSelect={() => runCommand(() => router.push('/app/projects?new=1'))}
            className={PALETTE_ITEM_CLASS}
          >
            <Plus className="text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{tNav('projectSwitcher.newProject')}</span>
          </CommandItem>
          <CommandItem
            value={`all-projects ${tNav('projectSwitcher.allProjects')}`}
            onSelect={() => runCommand(() => router.push('/app/projects'))}
            className={PALETTE_ITEM_CLASS}
          >
            <FolderKanban className="text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{tNav('projectSwitcher.allProjects')}</span>
            <JumpShortcut jumpKey="p" />
          </CommandItem>
          {canViewOrganization && (
            <CommandItem
              value={`organization ${tNav('userMenu.organization')}`}
              onSelect={() => runCommand(() => router.push('/app/organization'))}
              className={PALETTE_ITEM_CLASS}
            >
              <Building2 className="text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{tNav('userMenu.organization')}</span>
              <JumpShortcut jumpKey="o" />
            </CommandItem>
          )}
          <CommandItem
            value={`profile ${tNav('userMenu.profile')}`}
            onSelect={() => runCommand(() => router.push('/app/profile'))}
            className={PALETTE_ITEM_CLASS}
          >
            <UserRound className="text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{tNav('userMenu.profile')}</span>
          </CommandItem>
          <CommandItem
            value={`toggle-theme ${t('toggleTheme')}`}
            onSelect={() => runCommand(toggleTheme)}
            className={PALETTE_ITEM_CLASS}
          >
            {theme === 'dark' ? (
              <Sun className="text-muted-foreground" aria-hidden />
            ) : (
              <Moon className="text-muted-foreground" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{t('toggleTheme')}</span>
          </CommandItem>
          {authRequired && (
            <CommandItem
              value={`sign-out ${tCommon('actions.signOut')}`}
              onSelect={() => runCommand(() => void signOut())}
              className={PALETTE_ITEM_CLASS}
            >
              <LogOut className="text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{tCommon('actions.signOut')}</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
