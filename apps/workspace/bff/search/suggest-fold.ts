const LETTERS_FROM = 'ÄÖÜäöüÁÀÂáàâÉÈÊéèêÍÌÎíìîÓÒÔóòôÚÙÛúùûÇçÑñŠšŽžČčĆćÝý'
const LETTERS_TO = 'aouaouaaaaaaeeeeeeiiiiiioooooouuuuuuccnnsszzccccyy'
const SEPARATORS = '-_/.,;:()[]&+|"\'„“”‚‘’'

export const FOLD_FROM = LETTERS_FROM + SEPARATORS
export const FOLD_TO = LETTERS_TO + ' '.repeat([...SEPARATORS].length)

const FOLD = new Map([...FOLD_FROM].map((char, index) => [char, FOLD_TO[index]]))

export function foldForSuggest(value: string): string {
  let out = ''
  for (const char of value.normalize('NFC').toLowerCase()) out += FOLD.get(char) ?? char
  return out.replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim()
}
