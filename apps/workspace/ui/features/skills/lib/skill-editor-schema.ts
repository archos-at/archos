import { z } from 'zod'
import type { Translator } from '@/i18n'

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const DESCRIPTION_MAX = 1024

export interface EditorValues {
  name: string
  description: string
  body: string
}

export function buildSkillEditorSchema(t: Translator) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('editor.nameRequired'))
      .max(64, t('editor.nameTooLong'))
      .regex(SKILL_NAME_PATTERN, t('editor.nameInvalid')),
    description: z
      .string()
      .trim()
      .min(1, t('editor.descriptionRequired'))
      .max(1024, t('editor.descriptionTooLong')),
    body: z
      .string()
      .trim()
      .min(1, t('editor.bodyRequired'))
      .max(32000, t('editor.bodyTooLong')),
  })
}
