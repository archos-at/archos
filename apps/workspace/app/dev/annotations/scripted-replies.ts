export const OIB_RL_4 = {
  content: 'Gänge im Verlauf von Fluchtwegen müssen eine lichte Breite von mindestens 1,20 m aufweisen.',
  file_name: 'OIB-Richtlinie 4 · Nutzungssicherheit und Barrierefreiheit',
  number: 1,
  page: 4,
}

export const CORRIDOR_ANSWER =
  'Der Ausschnitt zeigt den Gang (Fluchtweg) zwischen Wohnen 1 und Zimmer 1. Die lichte Breite ist im Ausschnitt nicht kotiert; ' +
  'nach OIB-RL 4, Pkt. 2.2.1 braucht ein Fluchtweg hier mindestens 1,20 m [1]. Abgegriffen im Maßstab 1:100 sind es rund 1,75 m, ' +
  'das reicht. Die Kote sollte trotzdem in die Zeichnung, sonst ist der Nachweis nicht geführt.'
export const BOX_ANSWER =
  'Der Ausschnitt zeigt einen Teil des Regelgeschosses im Maßstab 1:100. Maße sind darin nicht kotiert, deshalb lässt sich ' +
  'gegen OIB-RL 4 nichts nachweisen [1]. Mit einer Bemaßung im Ausschnitt prüfe ich Breiten und Durchgänge gern nach.'
export const threadAnswer = (number: number) =>
  `Zu Anmerkung ${number}: Ich habe mir die Stelle angesehen. In dieser Fassung ist dazu noch nichts eingetragen; ` +
  'ich würde die Angabe mit der nächsten Fassung nachfordern und die Anmerkung bis dahin offen lassen.'
export const REVIEW_ANSWER =
  'Ich habe den Grundriss durchgesehen und drei Vorschläge gesetzt: die nicht kotierte Breite des Gangs (Fluchtweg), ' +
  'den fehlenden Feuerwiderstand der Tür zum Technikraum und die Belichtung von Zimmer 1. ' +
  'Sie stehen als Vorschläge in der Liste; übernehmen oder verwerfen Sie sie dort.'

export const FIXED_VERDICTS: Record<string, string> = {
  'ann-4': 'Weiterhin offen: Die Brüstung in Zimmer 1 ist in Fassung 3 weiter mit 0,90 m kotiert.',
  'ann-b2': 'In Grundriss_RG_Index-C behoben: Die Legende nennt jetzt den Lüftungsquerschnitt des Technikraums (0,04 m²).',
  'ann-b3': 'Weiterhin offen: Im Bad ist die Vorwand nur bis 1,20 m dargestellt; ein Schnitt dazu fehlt.',
}
