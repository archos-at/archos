import type { ComponentType } from 'react'
import {
  Archive,
  ArrowDownUp,
  AtSign,
  Hash,
  Building2,
  CircleCheck,
  Command,
  CornerDownLeft,
  Delete,
  Eye,
  FolderKanban,
  Keyboard,
  ListOrdered,
  MoreHorizontal,
  MailOpen,
  MessageCircle,
  MessageSquarePlus,
  Sparkles,
  SquareCheck,
  SquareDashed,
  WrapText,
  X,
} from 'lucide-react'

import { jumpSections, type ProjectSectionFlags } from './project-sections'

export type ShortcutIcon = ComponentType<{ className?: string }>

export type KeyCap = string

export const MOD: KeyCap = 'mod'

export type KeySegment =
  | { kind: 'chord'; caps: readonly KeyCap[] }
  | { kind: 'then' }
  | { kind: 'or' }
  | { kind: 'range' }

const chord = (...caps: KeyCap[]): KeySegment => ({ kind: 'chord', caps })
const THEN: KeySegment = { kind: 'then' }
const OR: KeySegment = { kind: 'or' }
const RANGE: KeySegment = { kind: 'range' }

export function modifierLabel(platform: string | undefined | null): '⌘' | 'Ctrl' {
  return /mac|iphone|ipad|ipod/i.test(platform ?? '') ? '⌘' : 'Ctrl'
}

export const LEADER_KEY = 'g'

export const LEADER_TIMEOUT_MS = 1500

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Hyper',
  'Meta',
  'NumLock',
  'OS',
  'ScrollLock',
  'Shift',
  'Super',
  'Symbol',
  'SymbolLock',
])

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

export interface ShortcutFlags extends ProjectSectionFlags {
  canViewOrganization?: boolean
  inboundMail?: boolean
}

export interface JumpTarget {
  key: string
  label: { namespace: 'nav' | 'collaboration' | 'shortcuts'; key: string }
  href: (projectId: string | null) => string | null
  scoped: boolean
  icon: ShortcutIcon
}

function globalJumpTargets(flags: ShortcutFlags): JumpTarget[] {
  const targets: JumpTarget[] = [
    {
      key: 'p',
      label: { namespace: 'nav', key: 'projectSwitcher.allProjects' },
      href: () => '/app/projects',
      scoped: false,
      icon: FolderKanban,
    },
  ]
  if (flags.canViewOrganization) {
    targets.push({
      key: 'o',
      label: { namespace: 'nav', key: 'userMenu.organization' },
      href: () => '/app/organization',
      scoped: false,
      icon: Building2,
    })
  }
  return targets
}

export function jumpTargets(flags: ShortcutFlags): JumpTarget[] {
  const sections: JumpTarget[] = jumpSections(flags).map((section) => ({
    key: section.shortcutKey as string,
    label: section.label ?? { namespace: 'nav' as const, key: `sections.${section.i18nKey}` },
    href: (projectId: string | null) => {
      if (section.href) return section.href
      if (!projectId) return null
      return section.segment ? `/app/projects/${projectId}/${section.segment}` : `/app/projects/${projectId}`
    },
    scoped: !section.href,
    icon: section.icon,
  }))

  return [...globalJumpTargets(flags), ...sections]
}

if (process.env.NODE_ENV !== 'production') {
  const keys = jumpTargets({
    canViewOrganization: true,
    showKnowledge: true,
    canAccessOfficeShelf: true,
    canAccessOfficeStandards: true,
    canCollaborate: true,
    canAccessInbox: true,
  }).map((target) => target.key)
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index)
  if (duplicate) {
    throw new Error(`[shortcuts] duplicate leader key "${LEADER_KEY} ${duplicate}"`)
  }
}

export function resolveJump(
  key: string,
  flags: ShortcutFlags,
  projectId: string | null,
): string | null {
  const target = jumpTargets(flags).find((candidate) => candidate.key === key.toLowerCase())
  return target ? target.href(projectId) : null
}

export type ShortcutOwner =
  | 'shell'
  | 'composer'
  | 'prompt'
  | 'overlay'
  | 'review'
  | 'inbox'
  | 'search'
  | 'inboundMail'

export type ShortcutGroupId = 'general' | 'navigation' | 'chat' | 'search' | 'review' | 'inbox' | 'inboundMail'

export interface ShortcutRow {
  id: string
  label: { namespace: 'nav' | 'collaboration' | 'shortcuts'; key: string }
  keys: readonly KeySegment[]
  owner: ShortcutOwner
  icon: ShortcutIcon
  gate?: keyof ShortcutFlags
}

export interface ShortcutSection {
  id: ShortcutGroupId
  i18nKey: ShortcutGroupId
  rows: ShortcutRow[]
  note: boolean
}

const shortcutLabel = (key: string) => ({ namespace: 'shortcuts' as const, key })

export function shortcutSections(flags: ShortcutFlags): ShortcutSection[] {
  const targets = jumpTargets(flags)

  const sections: ShortcutSection[] = [
    {
      id: 'general',
      i18nKey: 'general',
      note: false,
      rows: [
        {
          id: 'palette',
          label: shortcutLabel('palette'),
          keys: [chord(MOD, 'K')],
          owner: 'shell',
          icon: Command,
        },
        {
          id: 'cheatsheet',
          label: shortcutLabel('cheatsheet'),
          keys: [chord('?')],
          owner: 'shell',
          icon: Keyboard,
        },
        {
          id: 'dismiss',
          label: shortcutLabel('dismiss'),
          keys: [chord('Esc')],
          owner: 'overlay',
          icon: X,
        },
      ],
    },
    {
      id: 'navigation',
      i18nKey: 'navigation',
      note: targets.some((target) => target.scoped),
      rows: targets.map((target) => ({
        id: `jump-${target.key}`,
        label: target.label,
        keys: [chord(LEADER_KEY.toUpperCase()), THEN, chord(target.key.toUpperCase())],
        owner: 'shell' as const,
        icon: target.icon,
      })),
    },
    {
      id: 'chat',
      i18nKey: 'chat',
      note: false,
      rows: [
        {
          id: 'sendMessage',
          label: shortcutLabel('sendMessage'),
          keys: [chord('Enter'), OR, chord(MOD, 'Enter')],
          owner: 'composer',
          icon: CornerDownLeft,
        },
        {
          id: 'newLine',
          label: shortcutLabel('newLine'),
          keys: [chord('Shift', 'Enter')],
          owner: 'composer',
          icon: WrapText,
        },
        {
          id: 'mention',
          label: shortcutLabel('mention'),
          keys: [chord('@')],
          owner: 'composer',
          icon: AtSign,
          gate: 'canCollaborate',
        },
        {
          id: 'reference',
          label: shortcutLabel('reference'),
          keys: [chord('#')],
          owner: 'composer',
          icon: Hash,
        },
        {
          id: 'chooseOption',
          label: shortcutLabel('chooseOption'),
          keys: [chord('1'), RANGE, chord('9')],
          owner: 'prompt',
          icon: ListOrdered,
        },
      ],
    },
    {
      id: 'search',
      i18nKey: 'search',
      note: false,
      rows: [
        { id: 'searchHitActions', label: shortcutLabel('searchHitActions'), keys: [chord('Shift', 'F10')], owner: 'search', icon: MoreHorizontal },
      ],
    },
    {
      id: 'review',
      i18nKey: 'review',
      note: false,
      rows: [
        { id: 'reviewPoint', label: shortcutLabel('reviewPoint'), keys: [chord('C')], owner: 'review', icon: MessageSquarePlus },
        { id: 'reviewRegion', label: shortcutLabel('reviewRegion'), keys: [chord('R')], owner: 'review', icon: SquareDashed },
        { id: 'reviewAsk', label: shortcutLabel('reviewAsk'), keys: [chord('P')], owner: 'review', icon: Sparkles },
        { id: 'reviewStep', label: shortcutLabel('reviewStep'), keys: [chord('J'), OR, chord('K')], owner: 'review', icon: ArrowDownUp },
        { id: 'reviewSettle', label: shortcutLabel('reviewSettle'), keys: [chord('E')], owner: 'review', icon: CircleCheck },
        { id: 'reviewDismiss', label: shortcutLabel('reviewDismiss'), keys: [chord('⌫')], owner: 'review', icon: Delete },
        { id: 'reviewChat', label: shortcutLabel('reviewChat'), keys: [chord('/')], owner: 'review', icon: MessageCircle },
      ],
    },
    {
      id: 'inbox',
      i18nKey: 'inbox',
      note: false,
      rows: [
        { id: 'inboxStep', label: shortcutLabel('inboxStep'), keys: [chord('J'), OR, chord('K')], owner: 'inbox', icon: ArrowDownUp, gate: 'canAccessInbox' },
        { id: 'inboxOpen', label: shortcutLabel('inboxOpen'), keys: [chord('Enter')], owner: 'inbox', icon: CornerDownLeft, gate: 'canAccessInbox' },
        { id: 'inboxArchive', label: shortcutLabel('inboxArchive'), keys: [chord('E')], owner: 'inbox', icon: Archive, gate: 'canAccessInbox' },
        { id: 'inboxToggleRead', label: shortcutLabel('inboxToggleRead'), keys: [chord('U')], owner: 'inbox', icon: MailOpen, gate: 'canAccessInbox' },
      ],
    },
    {
      id: 'inboundMail',
      i18nKey: 'inboundMail',
      note: false,
      rows: [
        { id: 'inboundMailStep', label: shortcutLabel('inboundMailStep'), keys: [chord('J'), OR, chord('K')], owner: 'inboundMail', icon: ArrowDownUp, gate: 'inboundMail' },
        { id: 'inboundMailOpen', label: shortcutLabel('inboundMailOpen'), keys: [chord('Enter')], owner: 'inboundMail', icon: CornerDownLeft, gate: 'inboundMail' },
        { id: 'inboundMailSelect', label: shortcutLabel('inboundMailSelect'), keys: [chord('X')], owner: 'inboundMail', icon: SquareCheck, gate: 'inboundMail' },
        { id: 'inboundMailPreview', label: shortcutLabel('inboundMailPreview'), keys: [chord('Space')], owner: 'inboundMail', icon: Eye, gate: 'inboundMail' },
        { id: 'inboundMailFile', label: shortcutLabel('inboundMailFile'), keys: [chord('E')], owner: 'inboundMail', icon: CircleCheck, gate: 'inboundMail' },
        { id: 'inboundMailDismiss', label: shortcutLabel('inboundMailDismiss'), keys: [chord('⌫')], owner: 'inboundMail', icon: Delete, gate: 'inboundMail' },
      ],
    },
  ]

  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => !row.gate || Boolean(flags[row.gate])),
    }))
    .filter((section) => section.rows.length > 0)
}
