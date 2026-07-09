export interface SpeciesTrait {
  name: string
  description: string
}

export interface SubraceData {
  name: string
  extra: string
}

export interface SpeciesData {
  name: string
  description: string
  speed: number
  size: string
  traits: SpeciesTrait[]
  subraces: Record<string, SubraceData> | null
}

export interface SkillChoice {
  count: number
  from: string[]
}

export interface SubclassOption {
  id: string
  name: string
  description: string
}

export interface SubclassAtLevel1 {
  label: string
  options: SubclassOption[]
}

export interface ClassFeature {
  name: string
  description: string
  recharge?: 'short_rest' | 'long_rest' | 'daily'
  uses?: number
}

export type AbilityId = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'

export interface ClassData {
  name: string
  description: string
  playstyle: string
  hit_die: number
  hp_at_1: number
  armor_profs: string[]
  weapon_profs: string[]
  saving_throws: AbilityId[]
  skill_choices: SkillChoice
  subclass_at_1: SubclassAtLevel1 | null
  features_at_1: ClassFeature[]
  equipment_options: string[][]
  is_caster: boolean
  spellcasting_ability?: AbilityId
  cantrips_known?: number
  spells_known_at_1?: number
  spell_slots_at_1?: Record<number, number>
  spell_list_at_1?: string[]
  cantrip_list?: string[]
}

export interface BackgroundData {
  name: string
  description: string
  skills: string[]
  tools: string[]
  feat: string
  asi: { primary: AbilityId; secondary: AbilityId }
  equipment: string[]
}

export type SpeciesId =
  | 'human' | 'elf' | 'dwarf' | 'halfling' | 'gnome'
  | 'half_elf' | 'half_orc' | 'tiefling' | 'dragonborn'

export type ClassId =
  | 'barbarian' | 'bard' | 'cleric' | 'druid' | 'fighter' | 'monk'
  | 'paladin' | 'ranger' | 'rogue' | 'sorcerer' | 'warlock' | 'wizard'

export type BackgroundId =
  | 'acolyte' | 'artisan' | 'charlatan' | 'criminal' | 'entertainer'
  | 'farmer' | 'guard' | 'guide' | 'hermit' | 'noble' | 'sage'
  | 'sailor' | 'soldier' | 'wayfarer'
