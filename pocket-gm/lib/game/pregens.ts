import type { Lang } from '@/lib/i18n/config'
import type { Character } from '@/lib/types'
import type { AbilityId, ClassData, BackgroundData } from './srd-types'
import { assembleCharacter } from './assemble-character'
import { getClasses, getBackgrounds } from './srd-data'

export type PregenCharacter = Omit<Character, 'id' | 'user_id'> & { pregen_id: string }

interface PregenSpec {
  pregen_id: string
  name: Record<Lang, string>
  speciesId: string
  subraceId: string | null
  classId: string
  subclassId: string | null
  backgroundId: string
  abilityScores: Record<AbilityId, number>
}

const SPECS: PregenSpec[] = [
  {
    pregen_id: 'the_warrior',
    name: { en: 'The Warrior', fr: 'Le Guerrier' },
    speciesId: 'human', subraceId: null,
    classId: 'fighter', subclassId: 'dueling',
    backgroundId: 'soldier',
    abilityScores: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
  },
  {
    pregen_id: 'the_arcanist',
    name: { en: 'The Arcanist', fr: 'L\'Arcaniste' },
    speciesId: 'elf', subraceId: 'high_elf',
    classId: 'wizard', subclassId: null,
    backgroundId: 'sage',
    abilityScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  {
    pregen_id: 'the_protector',
    name: { en: 'The Protector', fr: 'Le Protecteur' },
    speciesId: 'dwarf', subraceId: 'hill_dwarf',
    classId: 'cleric', subclassId: null,
    backgroundId: 'acolyte',
    abilityScores: { str: 13, dex: 12, con: 14, int: 8, wis: 15, cha: 10 },
  },
  {
    pregen_id: 'the_hunter',
    name: { en: 'The Hunter', fr: 'Le Chasseur' },
    speciesId: 'elf', subraceId: 'wood_elf',
    classId: 'ranger', subclassId: null,
    backgroundId: 'guide',
    abilityScores: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
  },
]

function defaultSpellSelection(classId: string, lang: Lang): { cantrips: string[]; spellsKnown: string[] } {
  const cls = (getClasses(lang) as Record<string, ClassData>)[classId]
  if (!cls?.is_caster) return { cantrips: [], spellsKnown: [] }
  return {
    cantrips: (cls.cantrip_list || []).slice(0, cls.cantrips_known || 0),
    spellsKnown: (cls.spell_list_at_1 || []).slice(0, cls.spells_known_at_1 || 0),
  }
}

export function getPregens(lang: Lang): PregenCharacter[] {
  return SPECS.map(spec => {
    const { cantrips, spellsKnown } = defaultSpellSelection(spec.classId, lang)
    const cls = (getClasses(lang) as Record<string, ClassData>)[spec.classId]
    const bg = (getBackgrounds(lang) as Record<string, BackgroundData>)[spec.backgroundId]
    const chosenSkills = cls.skill_choices.from
      .filter(s => !bg.skills.includes(s))
      .slice(0, cls.skill_choices.count)
    const character = assembleCharacter({
      lang,
      name: spec.name[lang],
      speciesId: spec.speciesId,
      subraceId: spec.subraceId,
      classId: spec.classId,
      subclassId: spec.subclassId,
      backgroundId: spec.backgroundId,
      abilityScores: spec.abilityScores,
      bonusPrimary: bg.asi.primary,
      bonusSecondary: bg.asi.secondary,
      chosenSkills,
      cantrips,
      spellsKnown,
    })
    return { ...character, is_pregenerated: true, pregen_id: spec.pregen_id }
  })
}
