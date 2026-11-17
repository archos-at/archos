export const LEGACY_TURN_EVENT_KEYS: Readonly<Record<string, string>> = {
  'status.retrieval.punkt': 'status.retrieval.clause',
  'status.documents.archiv': 'status.documents.officeShelf',
}

export const LEGACY_TURN_EVENT_VALUE_NAMES: Readonly<Record<string, string>> = {
  punkt: 'clause',
}

export const modernizeTurnEventKey = (key: string): string => LEGACY_TURN_EVENT_KEYS[key] ?? key

export const modernizeTurnEventValueName = (key: string, name: string): string =>
  key === 'status.retrieval.clause' || key === 'status.retrieval.punkt'
    ? (LEGACY_TURN_EVENT_VALUE_NAMES[name] ?? name)
    : name
