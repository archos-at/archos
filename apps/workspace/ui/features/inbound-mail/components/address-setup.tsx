'use client'

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { Check, ChevronDown, Copy, Forward, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { EmailAddress } from '@/components/ui/email-address'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import type { InboundMailAddressView } from '@/lib/inbound-mail/inbound-mail-wire'
import {
  forwardingAddressesOf,
  forwardingListProblem,
  INBOUND_MAIL_FORWARDED_FROM_MAX,
  normalizeForwardingAddress,
} from '@/lib/inbound-mail/forwarding-addresses'
import { CLAUSE_JOIN } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FactLine } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

function CopyLineButton({ text, testId }: { text: string; testId: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [copied, raise] = useTransientFlag()
  return (
    <Button
      type="button"
      variant="inline"
      className="touch-target w-fit gap-1.5 text-xs"
      onClick={() => void navigator.clipboard?.writeText(text).then(raise, () => {})}
      data-testid={testId}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? t('address.setup.copied') : t('address.setup.copy')}
    </Button>
  )
}

export function AddressSetup({ address, inSettings, children }: { address: string; inSettings: boolean; children?: ReactNode }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [open, setOpen] = useState(false)
  const redirect = t(inSettings ? 'address.setup.redirectSettings' : 'address.setup.redirect', { address })
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="flex flex-col gap-3" data-testid="address-setup">
        <CollapsibleTrigger
          className="text-muted-foreground hover:text-foreground touch-target flex w-fit items-start gap-1.5 rounded-inline text-left text-xs outline-none transition-colors duration-quick ease-out focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
          data-testid="address-setup-toggle"
        >
          <ChevronDown className={cn('mt-px size-3.5 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none', !open && '-rotate-90')} aria-hidden />
          <span>
            <span className="text-foreground font-medium">{t('address.setup.title')}</span>
            {CLAUSE_JOIN}
            {t(inSettings ? 'address.setup.summarySettings' : 'address.setup.summary')}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pl-5">
          <div className="flex flex-col gap-0.5" data-testid="address-setup-redirect">
            <FactLine icon={Forward} tone="default">
              <span className="[overflow-wrap:anywhere]">{redirect}</span>
            </FactLine>
            <CopyLineButton text={redirect} testId="address-setup-redirect-copy" />
          </div>
          {children}
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@')
  return at === -1 ? null : address.slice(at + 1)
}

export function ForwardingAddresses({
  address,
  onSave,
}: {
  address: InboundMailAddressView & { address: string }
  onSave: (forwardedFrom: readonly string[]) => Promise<void>
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputId = `forwarded-from-${address.address}`
  const save = async (next: readonly string[]): Promise<boolean> => {
    const found = forwardingListProblem(next, domainOf(address.address))
    if (found) {
      setProblem(found === 'too_many' ? t('address.forwards.tooMany', { max: INBOUND_MAIL_FORWARDED_FROM_MAX }) : t(`address.forwards.${found === 'malformed' ? 'invalid' : 'projectAddress'}`))
      return false
    }
    setProblem(null)
    setSaving(true)
    try {
      await onSave(forwardingAddressesOf(next))
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }
  const add = async () => {
    if (normalizeForwardingAddress(draft) === '') return
    if (await save([...address.forwardedFrom, draft])) setDraft('')
  }
  return (
    <div className="flex flex-col gap-2" data-testid="address-forwards">
      <SectionLabel as="p">{t('address.forwards.title')}</SectionLabel>
      <p className="text-muted-foreground text-xs">{t('address.forwards.explain')}</p>
      {address.forwardedFrom.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={t('address.forwards.title')}>
          {address.forwardedFrom.map((forward) => (
            <li key={forward} className="flex items-center justify-between gap-2 font-mono text-[13px] leading-5" data-testid="address-forward">
              <EmailAddress address={forward} />
              {address.canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={t('address.forwards.remove', { address: forward })}
                  disabled={saving}
                  onClick={() => void save(address.forwardedFrom.filter((kept) => kept !== forward))}
                  data-testid="address-forward-remove"
                >
                  <X className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs" data-testid="address-forwards-none">{t('address.forwards.none')}</p>
      )}
      {address.canManage && (
        <Field>
          <FieldLabel htmlFor={inputId} className="sr-only">{t('address.forwards.label')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={inputId}
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              placeholder={t('address.forwards.placeholder')}
              aria-invalid={problem !== null}
              onChange={(event) => {
                setDraft(event.target.value)
                setProblem(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void add()
                }
              }}
              className="h-9"
              data-testid="address-forward-input"
            />
            <Button type="button" variant="secondary" size="sm" disabled={saving || draft.trim() === ''} onClick={() => void add()} data-testid="address-forward-add">
              <Plus className="size-4" aria-hidden />
              {t('address.forwards.add')}
            </Button>
          </div>
          {problem ? <FieldError data-testid="address-forward-problem">{problem}</FieldError> : <FieldDescription className="sr-only">{t('address.forwards.explain')}</FieldDescription>}
        </Field>
      )}
    </div>
  )
}
