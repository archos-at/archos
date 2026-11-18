import type { en } from '../en'

export const presence: typeof en.presence = {
  status: {
    connected: 'Verbunden',
    reconnecting: 'Verbindung unterbrochen',
    offline: 'Keine Verbindung',
  },
  retry: 'Erneut versuchen',
  tooltip: {
    connected: 'Sie sind verbunden. Alles ist auf dem aktuellen Stand.',
    reconnecting: 'Der Server antwortet gerade nicht. Es wird laufend von selbst erneut versucht.',
    offline: 'Dieses Gerät hat kein Netz. Sobald es wieder da ist, verbindet sich die Seite von selbst.',
  },
  piloti: {
    onBehalfOf: '{productName} · für {name}',
    forSuffix: '· für {name}',
    reading: 'liest Seite {page}',
  },
}
