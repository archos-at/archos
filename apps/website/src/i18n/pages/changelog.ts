const de = {
  meta: {
    title: 'Neuerungen',
    description: 'Was sich in {name} geändert hat, Woche für Woche zusammengefasst.',
  },
  hero: {
    title: 'Neuerungen.',
    text: 'Was sich in {name} geändert hat, Woche für Woche zusammengefasst.',
  },
  inApp: 'Jede einzelne Änderung, nach Bereich sortiert, finden Sie nach der Anmeldung in {name} unter Neuerungen.',
  formerName: 'Einträge aus der Zeit vor der Umbenennung nennen {name} bei seinem früheren Namen.',
  unreleased: 'In Kürze',
  empty: 'Noch keine Einträge. Die erste Zusammenfassung erscheint hier, sobald die Woche vorbei ist.',
  feed: {
    rssTitle: '{name} Neuerungen',
    link: 'Neuerungen als RSS-Feed abonnieren',
  },
};

const en: typeof de = {
  meta: {
    title: 'What’s new',
    description: 'What changed in {name}, summarised week by week.',
  },
  hero: {
    title: 'What’s new.',
    text: 'What changed in {name}, summarised week by week.',
  },
  inApp: 'Every single change, sorted by area, is in {name} under What’s new once you sign in.',
  formerName: 'Entries from before the rename call {name} by its former name.',
  unreleased: 'Coming up',
  empty: 'No entries yet. The first summary appears here once its week is over.',
  feed: {
    rssTitle: '{name} What’s new',
    link: 'Subscribe to what’s new as an RSS feed',
  },
};

export default { de, en };
