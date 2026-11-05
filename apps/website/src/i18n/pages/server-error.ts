/**
 * Copy of the page shown when a page rendered on request fails on our side (status 500,
 * src/pages/500.astro), both locales. `{name}` is the brand name, filled by `withName`.
 */
const de = {
  title: 'Etwas ist schiefgelaufen',
  description: 'Beim Laden dieser Seite ist auf unserer Seite ein Fehler aufgetreten.',
  hero: {
    code: 'Fehler 500',
    title: 'Hier ist etwas schiefgelaufen.',
    text: 'Der Fehler liegt bei uns, nicht bei Ihnen. Wir sehen uns das an. Laden Sie die Seite in ein paar Minuten neu, oder schreiben Sie uns, wenn es dringend ist.',
  },
  retry: 'Seite neu laden',
  home: 'Zur Startseite',
  contact: 'Kontakt aufnehmen',
};

const en: typeof de = {
  title: 'Something went wrong',
  description: 'An error on our side stopped this page from loading.',
  hero: {
    code: 'Error 500',
    title: 'Something went wrong here.',
    text: 'The fault is on our side, not yours. We are looking into it. Reload the page in a few minutes, or write to us if it is urgent.',
  },
  retry: 'Reload the page',
  home: 'Go to the home page',
  contact: 'Get in touch',
};

export default { de, en };
