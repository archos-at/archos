import type { Translator } from '@/i18n'

export function buildMarkdownLabels(t: Translator) {
  return {
    h1: t('editor.markdown.h1'),
    h2: t('editor.markdown.h2'),
    h3: t('editor.markdown.h3'),
    bold: t('editor.markdown.bold'),
    italic: t('editor.markdown.italic'),
    code: t('editor.markdown.code'),
    codeBlock: t('editor.markdown.codeBlock'),
    bulletList: t('editor.markdown.bulletList'),
    numberedList: t('editor.markdown.numberedList'),
    taskList: t('editor.markdown.taskList'),
    link: t('editor.markdown.link'),
    quote: t('editor.markdown.quote'),
    table: t('editor.markdown.table'),
    edit: t('editor.markdown.edit'),
    split: t('editor.markdown.split'),
    preview: t('editor.markdown.preview'),
    fullscreen: t('editor.markdown.fullscreen'),
  }
}
