'use client'

import type { JSX } from 'react'
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  Clock,
  HardDrive,
  Layers,
  Mail,
  MailCheck,
  MailClock,
  MailPlus,
  MailWarning,
  MailX,
  Megaphone,
  MessageSquare,
  ShieldAlert,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

import { INBOX_TYPE_PRESENTATION, UNKNOWN_TYPE_PRESENTATION, type InboxItemView, type InboxTypePresentation } from '@/lib/inbox/types'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { cn } from '@/lib/utils'

const ICONS: Record<Exclude<InboxTypePresentation['icon'], 'piloti'>, LucideIcon> =
  {
    'at-sign': AtSign,
    'message-square': MessageSquare,
    'user-plus': UserPlus,
    'check-circle': CheckCircle2,
    'hard-drive': HardDrive,
    'alert-triangle': AlertTriangle,
    clock: Clock,
    layers: Layers,
    megaphone: Megaphone,
    'shield-alert': ShieldAlert,
    mail: Mail,
    'mail-clock': MailClock,
    'mail-check': MailCheck,
    'mail-x': MailX,
    'mail-warning': MailWarning,
    'mail-plus': MailPlus,
  }

export function InboxItemFace({ item, size = 'md' }: { item: InboxItemView; size?: 'sm' | 'md' }): JSX.Element {
  const presentation = INBOX_TYPE_PRESENTATION[item.type] ?? UNKNOWN_TYPE_PRESENTATION
  if (presentation.icon === 'piloti') return <AgentGlyph size={size === 'md' ? 'lg' : 'md'} tone="outline" />
  if (item.actorUserId && item.actorName) {
    return <PersonAvatar person={{ userId: item.actorUserId, name: item.actorName }} size={size} />
  }
  const Icon = ICONS[presentation.icon]
  return (
    <span className={cn('flex items-center justify-center rounded-full bg-muted text-muted-foreground', size === 'md' ? 'size-8' : 'size-7')}>
      <Icon className={size === 'md' ? 'size-4' : 'size-3.5'} />
    </span>
  )
}
