/**
 * Copy of the page shown for an address that does not exist, both locales, and of
 * its variant for an old address removed on purpose (status 410, see redirects.mjs).
 * `{name}` is the brand name, filled by `withName`.
 */
const de = {
  title: 'Seite nicht gefunden',
  description: 'Diese Seite gibt es nicht oder nicht mehr.',
  hero: {
    code: 'Fehler 404',
    title: 'Diese Seite gibt es nicht.',
    text: 'Die Adresse ist falsch, oder die Seite wurde verschoben. Von der Startseite aus finden Sie alles, was {name} anbietet.',
  },
  gone: {
    code: 'Fehler 410',
    title: 'Diese Seite gibt es nicht mehr.',
    text: 'Wir haben sie bewusst entfernt, und keine andere Seite tritt an ihre Stelle. Von der Startseite aus finden Sie alles, was {name} heute anbietet.',
  },
  home: 'Zur Startseite',
  blog: 'Blog lesen',
  contact: 'Kontakt aufnehmen',
};

const en: typeof de = {
  title: 'Page not found',
  description: 'This page does not exist, or no longer does.',
  hero: {
    code: 'Error 404',
    title: 'This page does not exist.',
    text: 'The address is wrong, or the page has moved. The home page leads to everything {name} offers.',
  },
  gone: {
    code: 'Error 410',
    title: 'This page no longer exists.',
    text: 'We removed it on purpose, and no other page takes its place. The home page leads to everything {name} offers today.',
  },
  home: 'Go to the home page',
  blog: 'Read the blog',
  contact: 'Get in touch',
};

export default { de, en };
