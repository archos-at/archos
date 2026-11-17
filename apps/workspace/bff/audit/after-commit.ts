import 'server-only'
import { recordAuditEvent, type AuditEventInput } from './service'

export function recordAuditEventAfterCommit(input: AuditEventInput): void {
  const lost = (error: unknown) => console.warn(`[Audit] ${input.action} was not recorded:`, error)
  try {
    void Promise.resolve(recordAuditEvent(input)).catch(lost)
  } catch (error) {
    lost(error)
  }
}
