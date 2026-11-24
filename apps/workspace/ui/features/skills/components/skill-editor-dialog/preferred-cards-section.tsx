import type { Dispatch, JSX, SetStateAction } from 'react'
import { X } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Item, ItemContent, ItemDescription, ItemList, ItemTitle } from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SearchField } from '@/components/ui/search-field'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import type { CardCatalogEntry } from '../../lib/card-catalog'

interface SkillPreferredCardsSectionProps {
  preferredCards: string[]
  cardQuery: string
  setCardQuery: Dispatch<SetStateAction<string>>
  cardResults: readonly CardCatalogEntry[]
  catalogByType: Map<string, CardCatalogEntry>
  addCard: (type: string) => void
  removeCard: (type: string) => void
}

export function SkillPreferredCardsSection({
  preferredCards,
  cardQuery,
  setCardQuery,
  cardResults,
  catalogByType,
  addCard,
  removeCard,
}: SkillPreferredCardsSectionProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  return (
    <section className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{t('editor.cards.heading')}</h3>
        <p className="text-muted-foreground text-xs">{t('editor.cards.hint')}</p>
      </div>

      {preferredCards.length === 0 ? (
        <EmptyState variant="bare" title={t('editor.cards.empty')} className="py-3" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {preferredCards.map((type) => (
            <li key={type} className="flex flex-col items-start gap-0.5">
              <Chip variant="secondary" size="sm">
                <span className="font-mono">{type}</span>
                <button
                  type="button"
                  aria-label={t('editor.cards.removeAria', { type })}
                  onClick={() => removeCard(type)}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mr-0.5 rounded-sm leading-none transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Chip>
              <span className="text-muted-foreground text-xs">
                {catalogByType.get(type)?.description}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SearchField
        type="text"
        value={cardQuery}
        onChange={setCardQuery}
        placeholder={t('editor.cards.searchPlaceholder')}
        label={t('editor.cards.searchPlaceholder')}
      />

      <div className="h-44">
        {cardResults.length === 0 ? (
          <EmptyState
            variant="bare"
            title={t('editor.cards.noMatches')}
            className="flex h-full items-center py-3"
          />
        ) : (
          <ScrollArea className="h-full">
            <ItemList>
              {cardResults.map((entry) => (
                <Item key={entry.type} asChild>
                  <button type="button" onClick={() => addCard(entry.type)}>
                    <ItemContent>
                      <ItemTitle className="font-mono">{entry.type}</ItemTitle>
                      <ItemDescription>{entry.description}</ItemDescription>
                    </ItemContent>
                  </button>
                </Item>
              ))}
            </ItemList>
          </ScrollArea>
        )}
      </div>
    </section>
  )
}
