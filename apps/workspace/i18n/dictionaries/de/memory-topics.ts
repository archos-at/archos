import type { en } from '../en'

export const memoryTopics: typeof en.memoryTopics = {
  noTopic: 'Ohne Thema',
  topicCount: '{count, plural, one {# Notiz} other {# Notizen}}',
  moveTo: 'Verschieben nach …',
  newTopic: 'Neues Thema',
  rename: 'Thema umbenennen',
  renamePlaceholder: 'Name des Themas',
  mergeHint: 'Gibt es das Thema schon, werden beide zusammengeführt.',
  officeKeepsTopic: 'Notizen des Büros behalten ihr Thema.',
  removeTopic: 'Thema mit allen Notizen entfernen',
  removeTopicConfirm:
    '{count, plural, one {# Notiz in „{name}“ wird} other {# Notizen in „{name}“ werden}} endgültig entfernt.',
  ungroup: 'Thema auflösen',
  topicTooLong: 'Höchstens 40 Zeichen.',
  filterLabel: 'Thema',
}
