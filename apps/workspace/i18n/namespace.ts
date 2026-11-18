import { withProductName } from '@/lib/brand'
import type { Locale } from './config'
import { createTranslator, type Translator } from './translate'

export interface Namespace<Messages extends object = object> {
  readonly name: string
  readonly messages: Readonly<Record<Locale, Messages>>
}

export function defineNamespace<const Name extends string, Messages extends object>(
  name: Name,
  messages: Record<Locale, Messages>,
): Namespace<Messages> & { readonly name: Name } {
  return { name, messages: withProductName(messages) }
}

export function namespaceRoot(namespace: Namespace, locale: Locale): Record<string, object> {
  return { [namespace.name]: namespace.messages[locale] }
}

export function translatorFor(namespace: Namespace, locale: Locale, scope?: string): Translator {
  const path = scope ? `${namespace.name}.${scope}` : namespace.name
  return createTranslator(namespaceRoot(namespace, locale), path)
}
