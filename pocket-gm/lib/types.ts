export interface PendingRoll {
  dice: number
  mod: number
  modLabel: string
  type: 'skill' | 'attack' | 'save' | 'damage' | 'death' | 'init'
  label: string
  dc: number | null
  advantage: 'advantage' | 'disadvantage' | null
}

export interface InitiativeEntry {
  name: string
  init: number
  isPlayer: boolean
  isAlly: boolean
  alive: boolean
  ref: string
  surprised?: boolean
  downed?: boolean
  stabilized?: boolean
  dead?: boolean
}

export interface TokenUsage {
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  calls: number
}

export interface MapToken {
  id: string
  x: number
  y: number
  label: string           // 2-3 char abbreviation, e.g. "You", "Gob", "Etc"
  type: 'player' | 'enemy' | 'ally' | 'neutral'
  // Player/ally tokens: send HP values
  hp?: number
  hp_max?: number
  // Enemy tokens: send condition label only (never exact HP)
  condition?: 'healthy' | 'bloodied' | 'hurt' | 'critical' | 'defeated'
  status_effects?: string[]   // e.g. ['prone', 'restrained']
  is_active: boolean          // true = this token's turn
}

export interface BattleMap {
  grid: string    // compact row strings joined by \n
  width: number
  height: number
  tokens: MapToken[]
  cell_size_ft: number  // almost always 5
}

export interface GameState {
  hp: number
  hpMax: number
  conds: string[]
  inv: string[]
  gold: number
  notes: string
  spUsed: Record<number, number>
  dSucc: number
  dFail: number
  history: { role: 'user' | 'assistant'; content: string }[]
  pendRoll: PendingRoll | null
  inCombat: boolean
  combatRound: number
  initiative: InitiativeEntry[]
  currentTurn: number
  battleMap: BattleMap | null
  awaitingReaction: boolean
  tokens: TokenUsage
}

export interface SaveSlot {
  id: string
  user_id: string
  slot: number
  character_id: string
  state: GameState
  log_html: string | null
  turn_count: number
  updated_at: string
}

export interface EquipmentItem {
  name: string
  quantity: number
  notes?: string // e.g. "1d8+3 slashing, versatile"
}

export interface Feature {
  name: string
  description: string
  recharge?: 'short_rest' | 'long_rest' | 'daily'
  uses?: number
}

export interface Character {
  id: string
  user_id: string
  name: string
  pronouns?: string
  species: string
  subrace?: string
  class: string
  subclass?: string
  background: string
  level: number

  str: number; dex: number; con: number
  int: number; wis: number; cha: number

  hp_max: number
  ac: number
  speed: number

  saving_throw_profs: string[]
  skill_profs: string[]
  armor_profs: string[]
  weapon_profs: string[]
  tool_profs: string[]

  equipment: EquipmentItem[]
  features: Feature[]

  cantrips?: string[]
  spells_known?: string[]
  spell_slots?: Record<number, number>

  is_pregenerated: boolean
  campaign?: string
}

// Partial type used during the wizard
export type CharacterDraft = Partial<Character> & {
  abilityRolls?: number[] // raw rolled values before assignment
  rollsUsed?: number // 0 or 1 (max 1 reroll)
}

export interface DynamicStateForAPI {
  hp: number
  hpMax: number
  spUsed: Record<number, number>
  conds: string[]
  inv: string[]
  gold: number
  notes: string
  inCombat: boolean
  combatRound: number
  initiative: InitiativeEntry[]
  currentTurn: number
}
