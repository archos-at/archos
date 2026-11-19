import type { InboxItemType } from '@/lib/db/schema/inbox'
import type { InboxEmailDefault, InboxTypeDefinition } from './registry'

export const IN_APP_ONLY: InboxEmailDefault = { send: 'never' }

export const INBOUND_MAIL_TYPE_DEFINITIONS = {
  'inbound_mail.waiting': {
    actionable: true,
    grouping: 'collapse',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'inbound_mail.expiring': {
    actionable: true,
    grouping: 'collapse',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'inbound_mail.decided': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'inbound_mail.filing_failed': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'inbound_mail.cap_reached': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'inbound_mail.appended': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'mail_thread.follow_expiring': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'low' },
  },
  'inbound_mail.held': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'inbound_mail.held_for_writers': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'inbound_mail.rejected': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'inbound_mail.expired': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'mail_thread.follow_ended': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
} satisfies Partial<Record<InboxItemType, InboxTypeDefinition>>

export function appendedGroupAnchor(at: Date): string {
  return `day:${at.toISOString().slice(0, 10)}`
}
