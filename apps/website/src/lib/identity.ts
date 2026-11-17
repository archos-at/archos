import identityJson from '../styles/brand/identity.json';

export interface Identity {
  name: string;
  claim: string;
  legalEntity: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  domain: string;
  tagline: string;
}

const identity: Identity = identityJson;

export default identity;

const NAME_TOKEN = /\{name\}/g;

export function withName<T>(value: T): T {
  if (typeof value === 'string') return value.replace(NAME_TOKEN, identity.name) as T;
  if (Array.isArray(value)) return value.map((item) => withName(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withName(item)]),
    ) as T;
  }
  return value;
}
