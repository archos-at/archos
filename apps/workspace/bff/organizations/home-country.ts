import { z } from 'zod'

export const HOME_COUNTRIES = ['AT', 'DE', 'CH', 'LI'] as const
export type HomeCountry = (typeof HOME_COUNTRIES)[number]

export const homeCountrySchema = z.enum(HOME_COUNTRIES)

export const HOME_COUNTRY_TIME_ZONES: Readonly<Record<HomeCountry, string>> = {
  AT: 'Europe/Vienna',
  DE: 'Europe/Berlin',
  CH: 'Europe/Zurich',
  LI: 'Europe/Vaduz',
}
