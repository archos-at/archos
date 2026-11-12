import type { en } from '../en'

/** Themen einer Notizenliste (ADR-0180, Nachtrag „Themen“): gemeinsam für Mein Gedächtnis und das Projektgedächtnis. */
export const memoryTopics: typeof en.memoryTopics = {
  // Die Gruppe der Notizen ohne Thema, am Ende unter eigener Überschrift.
  noTopic: 'Ohne Thema',
  // Wie viele Notizen ein Thema hält, als Zusatz in der Überschrift.
  topicCount: '{count, plural, one {# Notiz} other {# Notizen}}',
  // Das Menü einer Notiz: wohin sie verschoben wird.
  moveTo: 'Verschieben nach …',
  // Die Option in der Themenauswahl, die ein neues Thema eröffnet.
  newTopic: 'Neues Thema',
  // Die Aktion an der Überschrift eines Themas, die es umbenennt oder in ein anderes zusammenführt.
  rename: 'Thema umbenennen',
  renamePlaceholder: 'Name des Themas',
  // Unter dem Namensfeld: Ein Name, den schon ein anderes Thema trägt, führt beide zusammen.
  mergeHint: 'Gibt es das Thema schon, werden beide zusammengeführt.',
  // Unter dem Namensfeld, wenn der Ordner Notizen des Büros hält: Umbenennen lässt sie beim Namen.
  officeKeepsTopic: 'Notizen des Büros behalten ihr Thema.',
  // Die Aktion, die ein Thema samt allen seinen Notizen entfernt (nur Mein Gedächtnis).
  removeTopic: 'Thema mit allen Notizen entfernen',
  // Vor dem Entfernen gefragt, mit der Zahl der Notizen, die wegfallen.
  removeTopicConfirm:
    '{count, plural, one {# Notiz in „{name}“ wird} other {# Notizen in „{name}“ werden}} endgültig entfernt.',
  // Die Aktion, die ein Thema auflöst: Seine Notizen bleiben, ohne Thema.
  ungroup: 'Thema auflösen',
  // Unter dem Themenfeld, wenn der Name länger als die Grenze ist.
  topicTooLong: 'Höchstens 40 Zeichen.',
  // Die Beschriftung des Themenfilters und des Themenfelds.
  filterLabel: 'Thema',
}
