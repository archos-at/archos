/**
 * intakeProfileStep namespace: step 5, Steckbrief: the Gebäudeklasse, what applies, what Piloti found, finishing
 * (`/app/projects/[id]/setup`, ticket 26, `docs/design/project-setup-five-steps.md`).
 */
export const intakeProfileStep = {
  heading: 'Project profile',
  /** How sure a value is, in words: who confirmed it and how many sources agree. Never a number. */
  confidence: {
    confirmed: 'Confirmed',
    ownAnswer: 'Your answer',
    contested: '{count} different values found',
    corroborated: 'Suggestion, {count} sources agree',
    single: 'Suggestion from one source',
    unsupported: 'Suggestion without a source',
  },
  /** The excerpt of the cited page, in a source's peek. */
  excerpt: {
    show: 'Excerpt',
    showAria: 'Show the excerpt of {name}, page {page}',
    hideAria: 'Hide the excerpt of {name}, page {page}',
    figure: 'Excerpt of {name}, page {page}',
    loading: 'Loading the page …',
    wholePage: 'The passage cannot be marked on this page. You are seeing the whole page.',
    unavailable: 'There is no excerpt for this page. The source opens the document.',
  },
  derivations: {
    basedOnSuggested:
      '{count, plural, one {Rests on # value nobody has confirmed yet.} other {Rests on # values nobody has confirmed yet.}}',
  },
  /** The result card: the Gebäudeklasse of a Bauwerk, its one-line reason, and how it was worked out. */
  class: {
    label: 'Gebäudeklasse',
    eyebrow: 'GK',
    title: 'Gebäudeklasse {value}',
    highRise: 'High-rise',
    highRiseTile: 'HH',
    open: 'Gebäudeklasse still open',
    highRiseReason: 'Escape level above 22 m: no Gebäudeklasse, OIB-RL 2.3 applies.',
    missing: 'Still missing: {inputs}.',
    none: '{productName} works it out once the storeys, the escape level and the units are known.',
    answer: 'Answer the questions',
    confirmed: 'Confirmed',
    how: 'How was it worked out?',
    howHide: 'Hide the working',
    inputs: 'Worked out from',
    suggestedMark: 'suggestion',
    buildings: 'Show the class of',
    reason: {
      escapeLevel: 'Escape level {value}',
      storeysAboveGround: '{value} storeys above ground',
      units: '{value} units',
      unitOver400: 'one above 400 m²',
      unitOver400None: 'none above 400 m²',
      grossFloorArea: 'Gross floor area {value}',
    },
  },
  /** The rule set's Ampel as chips: filled applies, a ring probably, dashed to check. */
  rules: {
    heading: 'What applies to this project',
    role: {
      binding: 'binding',
      guidance: 'guideline, not binding',
      interpretation: 'interpretation',
      authority_practice: 'authority practice',
      information: 'for information',
    },
    qualifier: {
      uncurated: 'not curated',
      office_maintained: 'kept by the office',
    },
    chipAria: '{name}, {role}',
    legend: {
      binding: 'Filled = binding',
      guidance: 'Ring = guideline',
      other: 'Dashed = interpretation or information',
    },
    gate: {
      organization_unplaced: 'Your office has no country yet, so {productName} names no law here. Set the country in the office settings.',
      site_unknown: 'The site is still missing. Once it is confirmed, the law that applies shows here.',
      not_entitled: 'This country’s law is not enabled for your office. The office’s own documents and standards still apply.',
      knowledge_unavailable: 'The law that applies could not be read just now. Try again later.',
      none: 'No law is recorded for this site yet.',
      empty: 'The records name no binding law for this site yet.',
    },
    basis: 'From the site and the platform’s reviewed records, as {productName} reads them in the chat.',
    disclaimer: 'Not legal advice.',
    ask: 'Ask {productName}',
    askQuestion: 'What does {name} require for this project?',
  },
  /** One table of what Piloti found: the decisive rows up front, the rest by topic. */
  findings: {
    heading: 'What {productName} found',
    description: 'Every value with the place it stands. Change only what is wrong; you take the rest in one step at the end.',
    counts: '{total, plural, one {# value} other {# values}} · {confirmed} by you',
    columns: {
      label: 'Item',
      value: 'Value',
      source: 'Source',
    },
    dismiss: 'Not right',
    dismissAria: '{value} for {label} is not right: discard',
    change: 'Change',
    changeAria: 'Change {label}',
    save: 'Use',
    cancel: 'Cancel',
    byYou: 'By you',
    suggestion: 'Suggestion',
    showAll: 'See all {count} values by topic',
    showLess: 'Show fewer',
    editor: 'Edit in the briefing editor',
    editorAria: 'Open the briefing editor for this project',
    empty: '{productName} has not found any values yet. They appear here once the reading has read documents.',
    reading: '{productName} is still reading. More values will be added.',
    building: 'Building {number}',
  },
  /** A value's source on its row, and the peek with the page excerpt. */
  source: {
    document: '{name} · p. {page}',
    documentNoPage: '{name}',
    geocoder: 'Address search',
    register: 'Address register',
    derivation: 'Derived',
    person: 'Your answer',
    none: 'No source',
    more: '+{count}',
    chipAria: 'Source of {label}: {source}',
    open: 'Open in the document',
    pinHint: 'Click the source to open the document.',
  },
  /** Contradictions are decided in the Rückfragen; one quiet line points there. */
  contradictions: {
    open: '{count, plural, one {# contradiction is still open.} other {# contradictions are still open.}}',
    resolve: 'Resolve it in the questions',
  },
  finish: {
    button: 'Finish setup',
    note: 'You can change any value later in the project settings.',
    takeAll: 'Take everything and finish',
    noteTakeAll: 'What you did not change, {productName} takes as it is, with its source. Everything stays changeable later.',
    closingTitle: 'Finish setup and close the project?',
    closingDescription: 'The project is closed with it: outcome “{outcome}”, period {period}.',
    confirm: 'Finish and close',
    cancel: 'Cancel',
  },
}
