/**
 * The `documents.metadata` key a filing choice is kept under (`./filing-choice.ts`).
 *
 * A leaf of its own because the document writes (`./repository/mutations.ts`)
 * record the choice under it, and they reach hundreds of specs: importing
 * `./filing-choice.ts` there put the mail modules its schemas read
 * (`@/lib/mail-thread/ingest-facts`) below every one of them
 * (`scripts/blast-radius.mjs`).
 */
export const FILING_CHOICE_METADATA_KEY = 'filingChoice'
