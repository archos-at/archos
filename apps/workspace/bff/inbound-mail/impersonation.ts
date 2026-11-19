import type { ImpersonationBasis, SenderFlag, SenderReason } from './inbound-mail-vocabulary'

export const REJECTED_SIGNATURE_REASONS = ['dkim_fail', 'dkim_policy', 'dkim_weak_algorithm', 'dkim_short_key'] as const satisfies readonly SenderReason[]

export function isRejectedSignature(reason: SenderReason): boolean {
  return (REJECTED_SIGNATURE_REASONS as readonly SenderReason[]).includes(reason)
}

export function impersonationOf<Sender extends { reason: SenderReason; flags: readonly SenderFlag[] }>(sender: Sender): ImpersonationBasis | null {
  if (sender.flags.includes('claims_member_name')) return 'member_name'
  if (isRejectedSignature(sender.reason)) return 'rejected_signature'
  return null
}
