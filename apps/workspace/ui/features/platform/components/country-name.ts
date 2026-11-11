/** A country's name in `locale` (`XA` stays `XA`), or the code when the runtime does not know it. Pure. */
export function countryName(countryId: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryId) ?? countryId
  } catch {
    return countryId
  }
}
