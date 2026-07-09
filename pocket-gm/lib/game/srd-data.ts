import type { Lang } from '@/lib/i18n/config'
import { SPECIES as SPECIES_EN, CLASSES as CLASSES_EN, BACKGROUNDS as BACKGROUNDS_EN, ALL_SKILLS as ALL_SKILLS_EN } from './srd-data.en'
import { SPECIES as SPECIES_FR, CLASSES as CLASSES_FR, BACKGROUNDS as BACKGROUNDS_FR, ALL_SKILLS as ALL_SKILLS_FR } from './srd-data.fr'

export type {
  SpeciesData, SubraceData, SpeciesTrait,
  ClassData, SkillChoice, SubclassOption, SubclassAtLevel1, ClassFeature, AbilityId,
  BackgroundData, SpeciesId, ClassId, BackgroundId,
} from './srd-types'

export function getSpecies(lang: Lang) {
  return lang === 'fr' ? SPECIES_FR : SPECIES_EN
}

export function getClasses(lang: Lang) {
  return lang === 'fr' ? CLASSES_FR : CLASSES_EN
}

export function getBackgrounds(lang: Lang) {
  return lang === 'fr' ? BACKGROUNDS_FR : BACKGROUNDS_EN
}

export function getAllSkills(lang: Lang): string[] {
  return lang === 'fr' ? ALL_SKILLS_FR : ALL_SKILLS_EN
}

export const ABILITY_LABELS: Record<Lang, Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', string>> = {
  en: { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' },
  fr: { str: 'FOR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'SAG', cha: 'CHA' },
}
