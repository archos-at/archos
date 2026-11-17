/**
 * The keys a typed address and a register row are compared by (ADR-0172). One
 * function each, used by the importer when it writes a row and by the resolver
 * when it reads a typed line, so the two cannot drift. Pure and client-safe.
 *
 * Folding is deliberately narrow: case, diacritics, `ß`, the `Str.`/`St.`
 * abbreviations and every separator. Nothing is fuzzy: a key either equals
 * the register's or the address is not found, and stays unverified.
 */

/** Lower case, `ß` → `ss`, diacritics dropped (`ö` → `o`), whitespace collapsed. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `Str.`/`str` at a word's end means `straße`; `St.` before a name means `Sankt`. */
function expandAbbreviations(folded: string): string {
  return folded.replace(/str\b\.?/g, 'strasse').replace(/\bst\b\.?/g, 'sankt ')
}

/** Only letters and digits survive: `Albach-Gasse`, `Albachgasse` and `Albach Gasse` are one key. */
function squeeze(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '')
}

/** The key of a street name (or, where a register row has no street, of its farm or place name). */
export function streetKey(name: string): string {
  return squeeze(expandAbbreviations(fold(name)))
}

/** The key of a place: a Gemeinde, an Ortschaft or a delivery place. `St. Pölten` and `Sankt Pölten` are one. */
export function placeKey(name: string): string {
  return squeeze(expandAbbreviations(fold(name)))
}

/** The key of a house number as the register writes it: `12 A` is `12a`, `3 - 5` is `3-5`. */
export function houseKey(number: string): string {
  return fold(number).replace(/\s+/g, '')
}
