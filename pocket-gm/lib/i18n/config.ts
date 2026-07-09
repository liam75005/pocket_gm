export const LOCALES = ['en', 'fr'] as const
export type Lang = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Lang = 'en'

export function isLang(value: string): value is Lang {
  return (LOCALES as readonly string[]).includes(value)
}
