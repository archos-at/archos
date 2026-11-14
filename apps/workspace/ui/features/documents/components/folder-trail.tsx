'use client'

import type { JSX, ReactNode } from 'react'
import { Fragment, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { ProjectSectionPlace } from '@/components/shell/project-section-frame'
import { useSectionPlaceRoot } from '@/components/shell/section-place'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import type { FolderItem } from '../file-types'

/** The chain of ancestors from the root to `folderId`, oldest first. */
export function folderPath(folders: FolderItem[], folderId: string | null): FolderItem[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const path: FolderItem[] = []
  let cursor = folderId === null ? undefined : byId.get(folderId)
  // Defensive bound: a corrupt parent chain must not hang the render.
  while (cursor && path.length <= folders.length) {
    path.unshift(cursor)
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  return path
}

/**
 * The levels the crumb names between the shelf and the open folder: all of them up to two, else the first, an
 * ellipsis for the middle and the parent (`Abgabepläne › … › Index C`). The open folder is the title, never a step.
 * Exported for its spec: the rule is the design language's „Inside a folder“.
 */
export function trailSteps(path: readonly FolderItem[]): { shown: FolderItem[]; hidden: FolderItem[] } {
  const ancestors = path.slice(0, -1)
  if (ancestors.length <= 2) return { shown: ancestors, hidden: [] }
  return { shown: [ancestors[0], ancestors[ancestors.length - 1]], hidden: ancestors.slice(1, -1) }
}

/** One step's look: the crumb's 12px, ink under the pointer, cut at 16rem with its whole name as the title. */
const STEP = 'block max-w-[16rem] truncate rounded-inline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-quick ease-out'

/** A phone crumb's step: 13px, a 44px target by its padding, hanging into the line. */
const PHONE_STEP = 'hover:text-foreground focus-visible:ring-ring -my-3 block rounded-inline py-3 focus-visible:outline-none focus-visible:ring-2'

const Separator = (): JSX.Element => <ChevronRight className="size-3 shrink-0" aria-hidden />

/**
 * Alle Dateien inside a folder, in the section's header: the folder's name as the page title, the way there as the
 * crumb after the project (`Dateien › Abgabepläne › … › Index C`, each step a way up and a drop target, through
 * `wrapStep`), and on a phone the ← to the parent. The path row the pane drew under the tabs said it a second time,
 * with „Alle Dateien“ still the title above it (dev, 2026-11-10: „All files doesn't make sense in a subfolder“).
 */
export function FolderPlaceInHeader({
  path,
  onNavigate,
  wrapStep,
  itemCount,
}: {
  /** What the open folder holds, said beside its name („240 Elemente“). */
  itemCount?: number
  /** Root to the open folder, oldest first (`folderPath`); never empty here. */
  path: readonly FolderItem[]
  onNavigate: (folderId: string | null) => void
  /** Each way up is a drop target in the pane's terms (`CrumbDropTarget`). */
  wrapStep: (folderId: string | null, label: string, step: ReactNode) => ReactNode
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const nav = useTranslations(navCopy)
  const current = path[path.length - 1]
  const parent = path.length > 1 ? path[path.length - 2] : null
  // The store's name (the Büroablage hands its own), or a project's „Dateien“.
  const root = useSectionPlaceRoot() ?? nav('sections.files')
  const { shown, hidden } = trailSteps(path)
  const step = (folderId: string | null, label: string): ReactNode =>
    wrapStep(
      folderId,
      label,
      <button type="button" data-attr="files-navigate" className={STEP} title={label} onClick={() => onNavigate(folderId)}>
        {label}
      </button>
    )
  const trail = (
    <span className="flex min-w-0 items-center gap-1" data-testid="folder-trail">
      <span className="shrink-0">{step(null, root)}</span>
      {shown.map((folder, index) => (
        <Fragment key={folder.id}>
          <Separator />
          {index === 1 && hidden.length > 0 && (
            <>
              <ActionMenu
                mode="dropdown"
                entries={hidden.map((level) => ({ type: 'item' as const, id: level.id, label: level.name, onSelect: () => onNavigate(level.id) }))}
                trigger={
                  <button type="button" className="hover:text-foreground focus-visible:ring-ring shrink-0 rounded-inline px-0.5 transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2" aria-label={t('folders.hiddenLevels', { count: hidden.length })} title={hidden.map((level) => level.name).join(' › ')} data-testid="folder-trail-more">
                    …
                  </button>
                }
              />
              <Separator />
            </>
          )}
          <span className="min-w-0">{step(folder.id, folder.name)}</span>
        </Fragment>
      ))}
    </span>
  )
  const up = useMemo(
    () => ({ label: t('folders.backTo', { name: parent?.name ?? root }), onSelect: () => onNavigate(parent?.id ?? null) }),
    [t, parent, root, onNavigate]
  )
  // A phone's crumb: the parent, and before it everything above it folded into „…“ (a menu of those levels), one line
  // above the title. Five levels deep the ← alone named no parent and offered no way up two levels (finding 4).
  const levels = [{ id: null, name: root }, ...path.slice(0, -1).map((folder) => ({ id: folder.id as string | null, name: folder.name }))]
  const near = levels.slice(-2)
  const folded = levels.length > 2 ? levels.slice(0, -1) : []
  const phoneTrail = (
    <span className="flex min-w-0 items-center gap-1" data-testid="folder-trail-phone">
      {folded.length > 0 ? (
        <>
          <ActionMenu
            mode="dropdown"
            entries={folded.map((level) => ({ type: 'item' as const, id: level.id ?? 'root', label: level.name, onSelect: () => onNavigate(level.id) }))}
            trigger={
              <button type="button" className="hover:text-foreground focus-visible:ring-ring -my-3 shrink-0 rounded-inline px-1 py-3 focus-visible:outline-none focus-visible:ring-2" aria-label={t('folders.hiddenLevels', { count: folded.length })} data-testid="folder-trail-phone-more">
                …
              </button>
            }
          />
          <Separator />
        </>
      ) : (
        near.length > 1 && (
          <>
            <button type="button" className={cn(PHONE_STEP, 'shrink-0')} onClick={() => onNavigate(null)}>
              {root}
            </button>
            <Separator />
          </>
        )
      )}
      <button type="button" className={cn(PHONE_STEP, 'min-w-0 truncate')} title={near.at(-1)?.name} onClick={() => onNavigate(near.at(-1)?.id ?? null)}>
        {near.at(-1)?.name}
      </button>
    </span>
  )
  const count = itemCount === undefined ? undefined : t('folders.items', { count: itemCount })
  return <ProjectSectionPlace title={current.name} trail={trail} phoneTrail={phoneTrail} up={up} count={count} />
}
