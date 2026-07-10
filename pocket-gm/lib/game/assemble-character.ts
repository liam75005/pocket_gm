import type { Character, EquipmentItem, Feature } from '@/lib/types'
import type { Lang } from '@/lib/i18n/config'
import type { AbilityId, ClassData, BackgroundData, SpeciesData } from './srd-types'
import { getSpecies, getClasses, getBackgrounds, getAllSkills } from './srd-data'
import { abilityMod, computeAC, computeHp, parseEquipmentList } from './derive'

export interface AssembleInput {
  lang: Lang
  name: string
  pronouns?: string
  speciesId: string
  subraceId: string | null
  classId: string
  subclassId: string | null
  backgroundId: string
  abilityScores: Record<AbilityId, number> // base values, before background bonus
  bonusPrimary: AbilityId // +2 background bonus, player-chosen
  bonusSecondary: AbilityId // +1 background bonus, player-chosen
  chosenSkills: string[] // player-picked class skill proficiencies (length === cls.skill_choices.count)
  cantrips: string[]
  spellsKnown: string[]
  campaign?: string
}

function finalizeSkills(cls: ClassData, speciesId: string, bg: BackgroundData, chosenSkills: string[], lang: Lang): string[] {
  const picked = new Set<string>([...bg.skills, ...chosenSkills])

  const bonusCount = speciesId === 'human' ? 1 : speciesId === 'half_elf' ? 2 : 0
  if (bonusCount > 0) {
    getAllSkills(lang).filter(s => !picked.has(s)).slice(0, bonusCount).forEach(s => picked.add(s))
  }
  return Array.from(picked)
}

const ORIGIN_FEAT_DESCRIPTION: Record<Lang, string> = {
  en: 'Origin feat granted by your background.',
  fr: 'Don d\'origine accordé par votre historique.',
}

export function assembleCharacter(input: AssembleInput): Omit<Character, 'id' | 'user_id'> {
  const speciesMap = getSpecies(input.lang) as Record<string, SpeciesData>
  const classMap = getClasses(input.lang) as Record<string, ClassData>
  const backgroundMap = getBackgrounds(input.lang) as Record<string, BackgroundData>
  const species = speciesMap[input.speciesId]
  const cls = classMap[input.classId]
  const bg = backgroundMap[input.backgroundId]
  if (!species || !cls || !bg) throw new Error('Unknown species/class/background id')

  const finalScores: Record<AbilityId, number> = { ...input.abilityScores }
  finalScores[input.bonusPrimary] += 2
  finalScores[input.bonusSecondary] += 1

  const conMod = abilityMod(finalScores.con)
  const dexMod = abilityMod(finalScores.dex)
  const wisMod = abilityMod(finalScores.wis)

  const kitRaw = cls.equipment_options[0]
  const equipment: EquipmentItem[] = [...parseEquipmentList(kitRaw), ...parseEquipmentList(bg.equipment)]
  const equipmentNames = [...kitRaw, ...bg.equipment]

  const ac = computeAC(input.classId, equipmentNames, dexMod, conMod, wisMod)
  const hpMax = computeHp(cls.hit_die, conMod)

  const features: Feature[] = [
    ...species.traits.map(t => ({ name: t.name, description: t.description })),
    ...cls.features_at_1.map(f => ({ name: f.name, description: f.description, recharge: f.recharge, uses: f.uses })),
  ]
  if (input.subraceId && species.subraces?.[input.subraceId]) {
    const sub = species.subraces[input.subraceId]
    features.push({ name: sub.name, description: sub.extra })
  }
  if (input.subclassId && cls.subclass_at_1) {
    const opt = cls.subclass_at_1.options.find((o: { id: string }) => o.id === input.subclassId)
    if (opt) features.push({ name: `${cls.subclass_at_1.label}: ${opt.name}`, description: opt.description })
  }
  features.push({ name: bg.feat, description: ORIGIN_FEAT_DESCRIPTION[input.lang] })

  return {
    name: input.name,
    pronouns: input.pronouns,
    species: input.speciesId,
    subrace: input.subraceId ?? undefined,
    class: input.classId,
    subclass: input.subclassId ?? undefined,
    background: input.backgroundId,
    level: 1,

    str: finalScores.str, dex: finalScores.dex, con: finalScores.con,
    int: finalScores.int, wis: finalScores.wis, cha: finalScores.cha,

    hp_max: hpMax, ac, speed: species.speed,

    saving_throw_profs: cls.saving_throws,
    skill_profs: finalizeSkills(cls, input.speciesId, bg, input.chosenSkills, input.lang),
    armor_profs: cls.armor_profs,
    weapon_profs: cls.weapon_profs,
    tool_profs: bg.tools,

    equipment,
    features,

    cantrips: cls.is_caster ? input.cantrips : undefined,
    spells_known: cls.is_caster ? input.spellsKnown : undefined,
    spell_slots: cls.is_caster ? cls.spell_slots_at_1 : undefined,

    is_pregenerated: false,
    campaign: input.campaign,
  }
}
