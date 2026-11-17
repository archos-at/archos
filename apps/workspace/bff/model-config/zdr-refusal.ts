const DATA_POLICY_MARKER = /data policy/i

export const ZDR_CANNED_REFUSAL_PREFIX =
  'Diese Frage konnte nicht beantwortet werden, weil das eingestellte Modell keinen Anbieter ohne Datenspeicherung hat'

export function isZdrPolicyRefusal(text: string | null | undefined): boolean {
  if (!text) return false
  return DATA_POLICY_MARKER.test(text) || text.includes(ZDR_CANNED_REFUSAL_PREFIX)
}
