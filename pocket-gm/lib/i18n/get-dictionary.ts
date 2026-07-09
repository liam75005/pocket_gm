import type { Lang } from './config'
import { en } from './dictionaries/en'
import { fr } from './dictionaries/fr'

const dictionaries = { en, fr }

export type Dictionary = typeof en

export function getDictionary(lang: Lang): Dictionary {
  return dictionaries[lang]
}

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
}
