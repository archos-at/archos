import type { Dispatch, JSX, SetStateAction } from 'react'
import type { SkillCategoryListItem } from '@/adapters/api/skills-client'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'

interface SkillCategorySectionProps {
  categoryId: string | null
  setCategoryId: Dispatch<SetStateAction<string | null>>
  categories: SkillCategoryListItem[]
}

export function SkillCategorySection({
  categoryId,
  setCategoryId,
  categories,
}: SkillCategorySectionProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  return (
    <section className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{t('editor.category.heading')}</h3>
        <p className="text-muted-foreground text-xs">{t('editor.category.hint')}</p>
      </div>
      <Field>
        <FieldLabel htmlFor="skill-category">{t('editor.category.label')}</FieldLabel>
        <Select
          value={categoryId ?? '__unsorted__'}
          onValueChange={(next) => setCategoryId(next === '__unsorted__' ? null : next)}
        >
          <SelectTrigger id="skill-category">
            <SelectValue placeholder={t('editor.category.unsorted')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unsorted__">{t('editor.category.unsorted')}</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </section>
  )
}
