import identity from '@/shared/brand/identity.json'

export const PRODUCT_NAME: string = identity.name

export const CONTACT_EMAIL: string = identity.email

const PRODUCT_NAME_TOKEN = /\{productName\}/g

export function withProductName<T>(dictionary: T): T {
  if (typeof dictionary === 'string') return dictionary.replace(PRODUCT_NAME_TOKEN, PRODUCT_NAME) as T
  if (Array.isArray(dictionary)) return dictionary.map(withProductName) as T
  if (dictionary && typeof dictionary === 'object') {
    return Object.fromEntries(
      Object.entries(dictionary).map(([key, value]) => [key, withProductName(value)]),
    ) as T
  }
  return dictionary
}

export const BRAND_MARK = {
  viewBox: '18.4 18 59.21 60',
  aspect: 59.21 / 60,
  path: 'M65.07 78L77.6 78L55.01 18L40.99 18L18.4 78L30.31 78L34.9 65.56L60.49 65.56ZM45.93 35.82L47.69 29.65L49.46 35.82L57.04 56.38L38.34 56.38Z',
} as const
