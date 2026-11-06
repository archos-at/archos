import type { en } from '../en'

/** Präsenz: der Verbindungspunkt der Shell, und für wen Piloti auf einer gemeinsamen Fläche da ist. */
export const presence: typeof en.presence = {
  status: {
    connected: 'Verbunden',
    // Der Zustand, kurz genug für eine Zeile der Leiste; was geschieht, sagt der Tooltip.
    reconnecting: 'Verbindung unterbrochen',
    offline: 'Keine Verbindung',
  },
  tooltip: {
    connected: 'Sie sind verbunden. Alles ist auf dem aktuellen Stand.',
    reconnecting: 'Der Server antwortet gerade nicht. Es wird laufend von selbst erneut versucht.',
    offline: 'Dieses Gerät hat kein Netz. Sobald es wieder da ist, verbindet sich die Seite von selbst.',
  },
  /**
   * Whose request Piloti is working on, wherever it is present (ADR-0105; EU AI
   * Act Art. 50). `{name}` is the person it acts for.
   */
  piloti: {
    /** The tooltip on Piloti's face in a presence stack. */
    onBehalfOf: '{productName} · für {name}',
    /** After the words on Piloti's cursor tag („Piloti“, „Treppe“), never clipped: „Treppe · für Anna“. */
    forSuffix: '· für {name}',
    /** Was Pilotis Zeiger sagt, während es eine Seite oder einen Ausschnitt liest, nach seinem Namen. */
    reading: 'liest Seite {page}',
  },
}
