'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { ArrowUp, AtSign, Mic, Paperclip } from 'lucide-react'

import { AddresseeIndicator } from '@/features/collaboration/components/AddresseeIndicator'
import type { DraftMention } from '@/lib/mentions/mention-text'
import { I18nProvider, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import { PRODUCT_NAME } from '@/lib/brand'
import { SectionLabel } from '@/components/ui/section-label'

const ANNA: DraftMention = { targetId: 'user_anna', display: 'Anna Berger' }
const TOBIAS: DraftMention = { targetId: 'user_tobias', display: 'Tobias Kern' }
const AGENT: DraftMention = { targetId: AGENT_MENTION_ID, display: PRODUCT_NAME }

function MockComposer({
  text,
  children,
  hint,
}: {
  text: string
  children: React.ReactNode
  hint?: { icon: 'at' | 'agent'; body: string }
}): JSX.Element {
  return (
    <div className="@container bg-card relative flex flex-col rounded-xl px-4 py-2.5 shadow-sm">
      <p className="min-h-[40px] px-1.5 py-1 text-[14.5px] leading-[1.5] text-foreground">{text}</p>

      {/* The real row's shape (ComposerControls): ONE line of controls, the
          mention offer at its start (folded to `@` in a card under 28rem), and
          the addressee statement (`order-last basis-full` inside the indicator)
          on its own line below.
          The Datengrundlage chip and the Deep Research pill left the real
          composer, so they left this copy too. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div className="contents">
          <span className="order-3 ml-auto flex shrink-0 items-center gap-1">
            <span className="text-muted-foreground inline-flex h-8 items-center px-1.5 text-xs font-semibold pointer-coarse:h-11">
              Mittel
            </span>
            <span className="text-subtle inline-flex size-[34px] items-center justify-center pointer-coarse:size-11">
              <Paperclip className="size-4" aria-hidden />
            </span>
            <span className="text-subtle inline-flex size-[34px] items-center justify-center pointer-coarse:size-11">
              <Mic className="size-4" aria-hidden />
            </span>
            <span className="bg-primary text-primary-foreground inline-flex size-9 items-center justify-center rounded-lg shadow-md pointer-coarse:size-11">
              <ArrowUp className="size-4" aria-hidden />
            </span>
          </span>
        </div>

        {children}
      </div>

      {hint && (
        <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed">
          {/* Only the `@` hint carries a glyph. The agent hint's spark went with
              the rest of the composer's AI marks — see `InputArea`. */}
          {hint.icon === 'at' && (
            <AtSign className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden />
          )}
          <span>{hint.body}</span>
        </p>
      )}
    </div>
  )
}

const Eyebrow = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <SectionLabel as="h2">
    {children}
  </SectionLabel>
)

function Previews(): JSX.Element {
  const t = useTranslations(collaborationCopy)

  return (
    <>
      <section className="space-y-3">
        <Eyebrow>Standard — der Chat fragt {PRODUCT_NAME}, ohne es zu sagen</Eyebrow>
        {/* `onMentionSomeone` is passed because the real composer passes it, and
            without it this preview quietly captured a state the product never
            shows: the affordance renders only when a handler exists, so every
            screenshot taken here was evidence for a variant nobody sees. */}
        <MockComposer text="Gilt die 40-m-Grenze auch für das nördliche Treppenhaus?">
          <AddresseeIndicator
            mentions={[]}
            awaitingHuman={false}
            onMentionSomeone={() => undefined}
          />
        </MockComposer>
      </section>

      <section className="space-y-3">
        <Eyebrow>Eine Person erwähnt — {PRODUCT_NAME} hält sich zurück</Eyebrow>
        <MockComposer
          text="@Anna Berger stimmt das für den Bestand?"
          hint={{
            icon: 'at',
            body: t('mentions.composerHint', { name: ANNA.display }),
          }}
        >
          <AddresseeIndicator mentions={[ANNA]} awaitingHuman={false} />
        </MockComposer>
      </section>

      <section className="space-y-3">
        <Eyebrow>Zwei Personen erwähnt</Eyebrow>
        <MockComposer
          text="@Anna Berger @Tobias Kern könnt ihr den Bestandsplan bestätigen?"
          hint={{
            icon: 'at',
            body: t('mentions.composerHintMany', {
              names: `${ANNA.display}, ${TOBIAS.display}`,
            }),
          }}
        >
          <AddresseeIndicator mentions={[ANNA, TOBIAS]} awaitingHuman={false} />
        </MockComposer>
      </section>

      <section className="space-y-3">
        <Eyebrow>Der Chat wartet auf eine Person — eine Nachricht ist eine Anmerkung</Eyebrow>
        <MockComposer
          text="Danke, lass dir Zeit."
          hint={{ icon: 'agent', body: t('mentions.addressee.agentHint') }}
        >
          <AddresseeIndicator mentions={[]} awaitingHuman />
        </MockComposer>
      </section>

      <section className="space-y-3">
        <Eyebrow>Person und {PRODUCT_NAME} erwähnt — beide werden adressiert</Eyebrow>
        <MockComposer text={"@Anna Berger @" + PRODUCT_NAME + " bitte gemeinsam prüfen."}>
          <AddresseeIndicator mentions={[ANNA, AGENT]} awaitingHuman />
        </MockComposer>
      </section>
    </>
  )
}

export default function ComposerAddresseePreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="composer-addressee-preview"
        className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8 text-foreground"
      >
        <div>
          <h1 className="text-xl font-semibold">Wer die Nachricht bekommt</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Die Aussage im Composer — überall dort, wo die Nachricht nicht an {PRODUCT_NAME} geht.
            Der Standardfall bleibt still; genau das macht die anderen lesbar.
          </p>
        </div>

        <Previews />
      </main>
    </I18nProvider>
  )
}
